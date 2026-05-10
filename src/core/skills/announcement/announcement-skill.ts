import { BaseSkill } from '../base-skill';
import type { SkillConfig, SkillResult, PipelineContext, Insight } from '../../types/skill';
import type { Announcement, AnnouncementType } from '../../types/stock';

/**
 * 公告解读 Skill
 * 分析近期公告，提取关键事件、情感倾向、风险信号
 */
export class AnnouncementSkill extends BaseSkill {
  constructor(config?: Partial<SkillConfig>) {
    super({
      id: 'announcement-analyzer',
      name: '公告解读',
      version: '1.0.0',
      enabled: true,
      dependencies: [],
      parallel: true,
      config: config?.config || {},
    });
  }

  async execute(context: PipelineContext): Promise<SkillResult> {
    try {
      const announcements = context.dataBundle.announcements;
      
      if (!announcements || announcements.length === 0) {
        return this.createSuccess(
          { announcementCount: 0 },
          [],
          '近期无重要公告'
        );
      }

      // 分析各维度
      const sentimentStats = this.analyzeSentiment(announcements);
      const typeDistribution = this.analyzeTypeDistribution(announcements);
      const keyEvents = this.extractKeyEvents(announcements);
      const riskSignals = this.detectRiskSignals(announcements);

      const insights: Insight[] = [
        ...this.generateSentimentInsights(sentimentStats, announcements.length),
        ...this.generateEventInsights(keyEvents),
        ...riskSignals,
      ];

      const summary = this.generateSummary(sentimentStats, keyEvents, riskSignals, announcements.length);

      return this.createSuccess(
        {
          announcementCount: announcements.length,
          sentimentStats,
          typeDistribution,
          keyEvents,
          recentAnnouncements: announcements.slice(0, 5).map(a => ({
            title: a.title,
            date: a.date,
            type: a.type,
            sentiment: a.sentiment,
          })),
        },
        insights,
        summary
      );
    } catch (error) {
      return this.createFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private analyzeSentiment(announcements: Announcement[]) {
    const stats = { positive: 0, neutral: 0, negative: 0, total: announcements.length };
    for (const a of announcements) {
      stats[a.sentiment]++;
    }
    return stats;
  }

  private analyzeTypeDistribution(announcements: Announcement[]) {
    const dist: Record<string, number> = {};
    for (const a of announcements) {
      dist[a.type] = (dist[a.type] || 0) + 1;
    }
    return dist;
  }

  private extractKeyEvents(announcements: Announcement[]) {
    const events: { title: string; date: string; type: AnnouncementType; impact: string }[] = [];
    
    for (const a of announcements.slice(0, 10)) {
      let impact = 'neutral';
      if (a.sentiment === 'positive') impact = 'positive';
      if (a.sentiment === 'negative') impact = 'negative';
      
      // 重大事项权重更高
      if (a.type === 'major_event' || a.type === 'acquisition') impact = a.sentiment === 'positive' ? 'high_positive' : 'high_negative';
      
      events.push({
        title: a.title,
        date: a.date,
        type: a.type,
        impact,
      });
    }
    
    return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private detectRiskSignals(announcements: Announcement[]): Insight[] {
    const signals: Insight[] = [];
    
    for (const a of announcements) {
      // 减持风险
      if (a.title.includes('减持')) {
        signals.push({
          type: 'risk',
          title: '股东减持风险',
          description: `发现股东减持公告：${a.title}`,
          confidence: 0.8,
          source: 'announcement-analyzer',
          metric: 'shareholder_change',
        });
      }
      
      // 诉讼风险
      if (a.type === 'lawsuit') {
        signals.push({
          type: 'risk',
          title: '法律诉讼风险',
          description: a.title,
          confidence: 0.85,
          source: 'announcement-analyzer',
        });
      }
      
      // 业绩预警
      if (a.title.includes('预减') || a.title.includes('预亏') || a.title.includes('下滑')) {
        signals.push({
          type: 'risk',
          title: '业绩下滑预警',
          description: a.title,
          confidence: 0.75,
          source: 'announcement-analyzer',
          metric: 'earnings_trend',
        });
      }
    }
    
    return signals;
  }

  private generateSentimentInsights(stats: { positive: number; neutral: number; negative: number; total: number }, total: number): Insight[] {
    const insights: Insight[] = [];
    const posRatio = stats.positive / total;
    const negRatio = stats.negative / total;
    
    if (posRatio > 0.5) {
      insights.push({
        type: 'opportunity',
        title: '公告情绪偏正面',
        description: `${total}条公告中，${Math.round(posRatio * 100)}%为正面，显示公司近期运作积极`,
        confidence: Number(posRatio.toFixed(2)),
        source: 'announcement-analyzer',
      });
    } else if (negRatio > 0.3) {
      insights.push({
        type: 'risk',
        title: '公告情绪偏负面',
        description: `${total}条公告中，${Math.round(negRatio * 100)}%为负面，需关注潜在风险`,
        confidence: Number(negRatio.toFixed(2)),
        source: 'announcement-analyzer',
      });
    }
    
    return insights;
  }

  private generateEventInsights(events: { impact: string }[]): Insight[] {
    const highImpact = events.filter(e => e.impact.startsWith('high_'));
    if (highImpact.length > 0) {
      return [{
        type: 'highlight',
        title: '重大事项关注',
        description: `近期有${highImpact.length}项重大事项公告，建议仔细阅读`,
        confidence: 0.9,
        source: 'announcement-analyzer',
      }];
    }
    return [];
  }

  private generateSummary(
    stats: { positive: number; neutral: number; negative: number; total: number },
    events: { impact: string }[],
    risks: Insight[],
    total: number
  ): string {
    const parts: string[] = [];
    parts.push(`近期共${total}条公告`);
    parts.push(`正面${stats.positive}条、中性${stats.neutral}条、负面${stats.negative}条`);
    
    const highImpact = events.filter(e => e.impact.startsWith('high_')).length;
    if (highImpact > 0) parts.push(`含${highImpact}项重大事项`);
    if (risks.length > 0) parts.push(`识别${risks.length}个风险信号`);
    
    return parts.join('；') + '。';
  }
}
