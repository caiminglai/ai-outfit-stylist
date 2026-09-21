/**
 * 柜体管理入口（Tab 调度器）
 *
 * 负责衣橱/化妆品/配饰三个标签页的切换调度。
 * 具体业务逻辑已拆分到：
 *   - WardrobeTab.tsx   衣橱管理
 *   - CosmeticTab.tsx   化妆品柜
 *   - AccessoryTab.tsx  配饰柜
 *   - CabinetConstants.ts  共享常量与辅助函数
 */
import { useState, useCallback } from 'react';
import type { CustomerProfile } from '../types';
import WardrobeTab from './WardrobeTab';
import CosmeticTab from './CosmeticTab';
import AccessoryTab from './AccessoryTab';
import ErrorBoundary from './ErrorBoundary';

/* ================================================================
   Props
   ================================================================ */

interface CabinetManagerProps {
  profile?: CustomerProfile | null;
  compact?: boolean;
}

type TabId = 'wardrobe' | 'cosmetic' | 'accessory';

/* ================================================================
   组件
   ================================================================ */

export default function CabinetManager({ profile, compact }: CabinetManagerProps) {
  const [activeTab, setActiveTab] = useState<TabId>('wardrobe');
  // 记录已访问过的 Tab，避免切换回来时重新加载数据
  const [visited, setVisited] = useState<Set<TabId>>(new Set(['wardrobe']));

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setVisited(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  const tabSize = compact ? '9px' : '12px';

  return (
    <div>
      {/* Tab 切换栏 */}
      <div style={{ display: 'flex', marginBottom: '12px' }}>
        <button
          className={`tab-btn ${activeTab === 'wardrobe' ? 'active' : ''}`}
          style={{ fontSize: tabSize }}
          onClick={() => handleTabChange('wardrobe')}
        >
          衣橱管理
        </button>
        <button
          className={`tab-btn ${activeTab === 'cosmetic' ? 'active' : ''}`}
          style={{ fontSize: tabSize }}
          onClick={() => handleTabChange('cosmetic')}
        >
          化妆品柜
        </button>
        <button
          className={`tab-btn ${activeTab === 'accessory' ? 'active' : ''}`}
          style={{ fontSize: tabSize }}
          onClick={() => handleTabChange('accessory')}
        >
          配饰柜
        </button>
      </div>

      {/* 内容区 —— 已访问过的 Tab 保持挂载（保留数据），未访问的不挂载（减少首屏请求）
          每个 Tab 包裹独立 ErrorBoundary，单个 Tab 崩溃不影响其他 Tab */}
      {visited.has('wardrobe') && (
        <div style={{ display: activeTab === 'wardrobe' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <WardrobeTab profile={profile} compact={compact} />
          </ErrorBoundary>
        </div>
      )}
      {visited.has('cosmetic') && (
        <div style={{ display: activeTab === 'cosmetic' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <CosmeticTab profile={profile} compact={compact} />
          </ErrorBoundary>
        </div>
      )}
      {visited.has('accessory') && (
        <div style={{ display: activeTab === 'accessory' ? 'block' : 'none' }}>
          <ErrorBoundary>
            <AccessoryTab profile={profile} compact={compact} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
