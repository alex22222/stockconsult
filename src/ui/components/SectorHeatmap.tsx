import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Flame, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';

const CLOUDBASE_API_URL = import.meta.env.VITE_CLOUDBASE_API_URL || '';

interface Sector {
  code: string;
  name: string;
  changePercent: number;
  netInflow: number;
  netInflowPercent: number;
}

interface TreemapNode {
  sector: Sector;
  x: number;
  y: number;
  w: number;
  h: number;
}

function formatBillion(yuan: number): string {
  const b = yuan / 1e8;
  if (Math.abs(b) >= 100) return `${b.toFixed(0)}亿`;
  if (Math.abs(b) >= 10) return `${b.toFixed(1)}亿`;
  return `${b.toFixed(2)}亿`;
}

function getHeatColor(netInflow: number, maxAbs: number): string {
  const ratio = Math.min(Math.abs(netInflow) / maxAbs, 1);
  if (netInflow > 0) {
    // 红色系：浅红 → 深红
    const r = Math.round(220 + ratio * 35);
    const g = Math.round(120 - ratio * 100);
    const b = Math.round(120 - ratio * 100);
    return `rgb(${r}, ${g}, ${b})`;
  }
  // 绿色系：浅绿 → 深绿
  const r = Math.round(120 - ratio * 100);
  const g = Math.round(180 + ratio * 50);
  const b = Math.round(120 - ratio * 100);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 简化版 Treemap 布局（水平条带法）
 * 目标：让每个矩形的宽高比尽量接近 1
 */
function computeTreemap(sectors: Sector[], W: number, H: number): TreemapNode[] {
  if (sectors.length === 0) return [];
  const values = sectors.map((s) => Math.abs(s.netInflow));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const nodes: TreemapNode[] = [];
  let remainingValues = [...values];
  let remainingSectors = [...sectors];
  let y = 0;
  let remainingH = H;
  let remainingTotal = total;

  while (remainingValues.length > 0) {
    // 在当前剩余空间内，决定这一行放多少个元素
    // 策略：让这一行的矩形尽量接近正方形
    const row: { idx: number; val: number }[] = [];
    let rowTotal = 0;
    let bestScore = Infinity;
    let bestRowLen = 1;

    for (let i = 1; i <= remainingValues.length; i++) {
      const slice = remainingValues.slice(0, i);
      const sliceTotal = slice.reduce((a, b) => a + b, 0);
      const rowH = (sliceTotal / remainingTotal) * remainingH;
      // 计算这行内最差的宽高比
      let maxRatio = 0;
      for (const v of slice) {
        const w = (v / sliceTotal) * W;
        const ratio = Math.max(w / rowH, rowH / w);
        if (ratio > maxRatio) maxRatio = ratio;
      }
      if (maxRatio < bestScore) {
        bestScore = maxRatio;
        bestRowLen = i;
      }
    }

    for (let i = 0; i < bestRowLen; i++) {
      row.push({ idx: i, val: remainingValues[i] });
      rowTotal += remainingValues[i];
    }

    const rowHeight = (rowTotal / remainingTotal) * remainingH;
    let x = 0;

    for (const item of row) {
      const blockW = (item.val / rowTotal) * W;
      nodes.push({
        sector: remainingSectors[item.idx],
        x,
        y,
        w: blockW,
        h: rowHeight,
      });
      x += blockW;
    }

    y += rowHeight;
    remainingValues = remainingValues.slice(bestRowLen);
    remainingSectors = remainingSectors.slice(bestRowLen);
    remainingH -= rowHeight;
    remainingTotal -= rowTotal;
  }

  return nodes;
}

function SectorBlock({
  sector,
  maxAbs,
  style,
}: {
  sector: Sector;
  maxAbs: number;
  style: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const isInflow = sector.netInflow > 0;
  const bg = getHeatColor(sector.netInflow, maxAbs);
  const isLarge = style.width !== undefined && (style.width as number) > 80;

  const handleEnter = (e: React.MouseEvent) => {
    setHovered(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div
      className="absolute rounded-lg overflow-hidden cursor-default select-none"
      style={{ ...style, backgroundColor: bg }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="px-1.5 py-1 h-full flex flex-col justify-center">
        <div className={`font-semibold text-white leading-tight truncate ${isLarge ? 'text-[12px]' : 'text-[10px]'}`}>
          {sector.name}
        </div>
        {(isLarge || (style.height !== undefined && (style.height as number) > 36)) && (
          <div className="text-[9px] text-white/90 mt-0.5 flex items-center gap-0.5">
            {isInflow ? (
              <TrendingUp className="w-2 h-2" />
            ) : (
              <TrendingDown className="w-2 h-2" />
            )}
            {formatBillion(sector.netInflow)}
          </div>
        )}
      </div>

      {/* 气泡 Tooltip — Portal 到 body，彻底脱离 overflow-hidden / transform 限制 */}
      {hovered && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="-translate-x-1/2 -translate-y-full -mt-2">
            <div className="bg-white text-gray-900 text-[11px] rounded-xl px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)] border border-gray-100 whitespace-nowrap">
              {/* 板块名 */}
              <div className="font-bold text-[13px] mb-1">{sector.name}</div>
              {/* 涨跌幅 大号突出 */}
              <div className="flex items-center gap-1.5">
                <span className={`text-base font-bold ${sector.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {sector.changePercent >= 0 ? '+' : ''}{sector.changePercent.toFixed(2)}%
                </span>
                <span className="text-[10px] text-gray-400">
                  {sector.changePercent >= 0 ? '▲' : '▼'}
                </span>
              </div>
              {/* 分隔线 */}
              <div className="my-1.5 border-t border-gray-100" />
              {/* 资金流向 */}
              <div className="space-y-0.5 text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="text-[10px]">主力净流入</span>
                  <span className={`font-medium ${isInflow ? 'text-red-500' : 'text-green-500'}`}>
                    {isInflow ? '+' : ''}{formatBillion(sector.netInflow)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px]">主力净占比</span>
                  <span className={`font-medium ${isInflow ? 'text-red-500' : 'text-green-500'}`}>
                    {isInflow ? '+' : ''}{sector.netInflowPercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
            {/* 下箭头 */}
            <div className="flex justify-center">
              <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-white" />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function SectorHeatmap() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const fetchSectors = useCallback(async () => {
    if (!CLOUDBASE_API_URL) return;
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${CLOUDBASE_API_URL}/sector-fund-flow`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success && Array.isArray(data.sectors)) {
        setSectors(data.sectors);
      } else {
        setError('数据格式异常');
      }
    } catch (e: any) {
      setError(e.message || '获取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSectors();
  }, [fetchSectors]);

  // 监听容器尺寸（ResizeObserver 比 window.resize 更精准）
  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ w: rect.width, h: rect.height });
      }
    }
    updateSize();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => updateSize());
      ro.observe(containerRef.current);
    } else {
      window.addEventListener('resize', updateSize);
    }

    return () => {
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener('resize', updateSize);
      }
    };
  }, [sectors, expanded]);

  const maxAbs = sectors.length > 0
    ? Math.max(...sectors.map((s) => Math.abs(s.netInflow)))
    : 1;

  const treemapNodes = containerSize.w > 0 && sectors.length > 0
    ? computeTreemap(sectors, containerSize.w, Math.max(containerSize.w * 0.6, 280))
    : [];

  return (
    <div className="w-full">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Flame className="w-3.5 h-3.5 text-orange-500" />
          <span>板块热力图</span>
          <span className="text-[10px] text-gray-300">(主力净流入)</span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && sectors.length > 0 && (
            <span className="text-[10px] text-gray-300">
              红=流入 / 绿=流出 / 面积=量级
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && (
        <>
          {loading && sectors.length === 0 && (
            <div className="w-full h-[280px] bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          )}

          {error && (
            <div className="text-center py-4">
              <p className="text-xs text-gray-400">{error}</p>
              <button
                onClick={fetchSectors}
                className="mt-2 text-xs text-blue-500 hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && sectors.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-gray-400">暂无数据</p>
            </div>
          )}

          {sectors.length > 0 && (
            <div
              ref={containerRef}
              className="w-full relative rounded-xl overflow-hidden"
              style={{ height: Math.max(containerSize.w * 0.6, 280) }}
            >
              {treemapNodes.map((node) => (
                <SectorBlock
                  key={node.sector.code}
                  sector={node.sector}
                  maxAbs={maxAbs}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: Math.max(node.w - 2, 1),
                    height: Math.max(node.h - 2, 1),
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
