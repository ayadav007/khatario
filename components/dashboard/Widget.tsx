'use client';

import React from 'react';
import { GripVertical, X, Maximize2, Minimize2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface WidgetConfig {
  id: string;
  type: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  config?: Record<string, any>;
}

interface WidgetProps {
  widget: WidgetConfig;
  onRemove: (id: string) => void;
  onResize: (id: string, size: { width: number; height: number }) => void;
  isDragging?: boolean;
  isEditMode?: boolean;
  children: React.ReactNode;
}

export const Widget: React.FC<WidgetProps> = ({
  widget,
  onRemove,
  onResize,
  isDragging = false,
  isEditMode = false,
  children,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleExpand = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      onResize(widget.id, { width: 2, height: 2 });
    } else {
      onResize(widget.id, { width: 1, height: 1 });
    }
  };

  return (
    <div
      className={`
        relative
        ${isDragging ? 'opacity-50 cursor-grabbing' : ''}
        ${isEditMode ? 'ring-2 ring-primary-300 dark:ring-primary-600' : ''}
      `}
      style={{
        gridColumn: `span ${widget.size.width}`,
        gridRow: `span ${widget.size.height}`,
      }}
    >
      <Card className="h-full flex flex-col">
        {/* Widget Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {isEditMode && (
              <div className="drag-handle cursor-grab active:cursor-grabbing">
                <GripVertical className="w-4 h-4 text-text-muted" />
              </div>
            )}
            <h3 className="font-semibold text-text-primary">
              {widget.title}
            </h3>
          </div>

          {isEditMode && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleExpand}
                className="p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
                title={isExpanded ? 'Minimize' : 'Maximize'}
              >
                {isExpanded ? (
                  <Minimize2 className="w-4 h-4 text-text-secondary" />
                ) : (
                  <Maximize2 className="w-4 h-4 text-text-secondary" />
                )}
              </button>
              <button
                onClick={() => onRemove(widget.id)}
                className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors"
                title="Remove widget"
              >
                <X className="w-4 h-4 text-red-600 dark:text-red-400" />
              </button>
            </div>
          )}
        </div>

        {/* Widget Content */}
        <div className="flex-1 p-4 overflow-auto">
          {children}
        </div>
      </Card>
    </div>
  );
};
