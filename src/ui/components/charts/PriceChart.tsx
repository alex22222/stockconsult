import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { PricePoint } from '../../../core/types/stock';

interface PriceChartProps {
  data: PricePoint[];
  height?: number;
}

export function PriceChart({ data, height = 280 }: PriceChartProps) {
  if (!data || data.length === 0) return null;

  // 过滤掉无效数据点（close <= 0）
  const validData = data.filter(d => d.close > 0 && d.date);
  if (validData.length === 0) return null;

  const minPrice = Math.min(...validData.map(d => d.low));
  const maxPrice = Math.max(...validData.map(d => d.high));
  const padding = (maxPrice - minPrice) * 0.1;

  // 简化日期显示
  const formattedData = validData.map(d => ({
    ...d,
    label: d.date.slice(5), // MM-DD
  }));

  // 只显示部分x轴标签避免拥挤
  const showEvery = Math.ceil(formattedData.length / 8);

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            interval={showEvery - 1}
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={50}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '12px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            }}
            labelStyle={{ color: '#6b7280', fontSize: '11px' }}
            formatter={(value) => [`${Number(value).toFixed(2)}`, '收盘价']}
            labelFormatter={(label) => `日期: ${String(label)}`}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="url(#priceGradient)"
            dot={false}
            activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
