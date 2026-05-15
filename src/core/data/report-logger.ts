/**
 * 分析报告落库到 CloudBase COS
 * 保存完整的分析报告（含核心观点、关键指标、市场解读、行动建议等）
 * 按右侧目录结构组织数据
 */

import type { AnalysisReport } from '../types/analysis';
import type { StockDataBundle } from '../types/stock';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

export interface ReportRecord {
  query: string;
  stock: {
    code: string;
    name: string;
    exchange: string;
    industry: string;
    marketCap: number;
  };
  sections: {
    coreView: AnalysisReport['coreView'];
    keyMetrics: AnalysisReport['keyMetrics'];
    marketInterpretation: AnalysisReport['marketInterpretation'];
    actionAdvice: AnalysisReport['actionAdvice'];
    rawInsights: AnalysisReport['rawInsights'];
  };
  dataBundle: {
    market: {
      price: number;
      change: number;
      changePercent: number;
      pe: number;
      pb: number;
      high52w: number;
      low52w: number;
      updateTime?: string;
    };
    financial: {
      grossMargin: number;
      netMargin: number;
      roe: number;
      debtRatio: number;
      revenueGrowth?: number;
      profitGrowth?: number;
    };
    newsCount: number;
    reportsCount: number;
  };
  timestamp: string;
  source: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * 保存完整分析报告到 COS
 * 静默失败，不阻断主流程
 */
export async function logReport(
  query: string,
  report: AnalysisReport,
  dataBundle: StockDataBundle
): Promise<void> {
  if (!CLOUDBASE_API_URL) {
    console.warn('[ReportLogger] CLOUDBASE_API_URL not configured, skipping log');
    return;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}-${minutes}-${seconds}`;
  const safeName = report.stock.name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '_').slice(0, 20);
  const filename = `reports/${dateStr}/${timeStr}_${report.stock.code}_${safeName}.json`;

  const record: ReportRecord = {
    query,
    stock: {
      code: report.stock.code,
      name: report.stock.name,
      exchange: report.stock.exchange,
      industry: report.stock.industry,
      marketCap: report.stock.marketCap,
    },
    sections: {
      coreView: report.coreView,
      keyMetrics: report.keyMetrics,
      marketInterpretation: report.marketInterpretation,
      actionAdvice: report.actionAdvice,
      rawInsights: report.rawInsights,
    },
    dataBundle: {
      market: {
        price: dataBundle.market.price,
        change: dataBundle.market.change,
        changePercent: dataBundle.market.changePercent,
        pe: dataBundle.market.pe,
        pb: dataBundle.market.pb,
        high52w: dataBundle.market.high52w,
        low52w: dataBundle.market.low52w,
        updateTime: dataBundle.market.updateTime,
      },
      financial: {
        grossMargin: dataBundle.financial.grossMargin,
        netMargin: dataBundle.financial.netMargin,
        roe: dataBundle.financial.roe,
        debtRatio: dataBundle.financial.debtRatio,
        revenueGrowth: dataBundle.financial.revenueGrowth,
        profitGrowth: dataBundle.financial.profitGrowth,
      },
      newsCount: dataBundle.news?.length || 0,
      reportsCount: dataBundle.reports?.length || 0,
    },
    timestamp: now.toISOString(),
    source: 'web',
  };

  try {
    console.log('[ReportLogger] Uploading:', filename);
    const response = await fetch(`${CLOUDBASE_API_URL}/upload-record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data: record }),
    });

    if (!response.ok) {
      console.warn('[ReportLogger] Upload failed:', response.status);
      return;
    }

    const result = await response.json().catch(() => null);
    if (result?.success) {
      console.log('[ReportLogger] Report saved:', filename);
    } else {
      console.warn('[ReportLogger] Upload returned:', result);
    }
  } catch (error) {
    console.warn('[ReportLogger] Error:', error);
  }
}
