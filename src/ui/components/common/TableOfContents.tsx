import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';

interface TocItem {
  id: string;
  label: string;
}

interface TableOfContentsProps {
  items: TocItem[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  const handleClick = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const headerOffset = 80;
      const elementPosition = el.getBoundingClientRect().top + window.scrollY;
      const offsetPosition = elementPosition - headerOffset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      }
    );

    items.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });

    const first = document.getElementById(items[0]?.id);
    if (first) {
      const rect = first.getBoundingClientRect();
      if (rect.top >= 0 && rect.top <= window.innerHeight) {
        setActiveId(items[0].id);
      }
    }

    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2">
        目录
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => handleClick(item.id)}
              className={clsx(
                'w-full text-left px-2 py-1.5 text-sm rounded-md transition-all duration-200 border-l-2',
                activeId === item.id
                  ? 'text-blue-700 bg-blue-50 border-blue-500 font-medium'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
