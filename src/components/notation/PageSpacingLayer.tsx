import React, { useState, useRef, useEffect } from 'react';
import { SpacingObject, ToolMode, SelectionState, Measure } from '../../types/score';

interface PageSpacingLayerProps {
  pageIndex: number;
  pageWidth: number;
  pageHeight?: number;
  pageMarginBottom?: number;
  staffMarginLeft: number;
  staffMarginRight: number;
  zoom?: number;
  systems: Array<{
    systemIndex: number;
    measures: Array<{
      measure: Measure;
      measureIdx: number;
      width: number;
    }>;
  }>;
  systemPositions: Array<{
    globalSysIdx: number;
    systemY: number;
    measureBlockHeight: number;
    extraSpace: number;
    lastMeasure: Measure;
  }>;
  spacingObjects: SpacingObject[];
  selection: SelectionState;
  toolMode: ToolMode;
  onSelectSpace?: (spaceId: string) => void;
  onAddSpace?: (afterMeasureId: string, amount: number, systemIndex: number) => void;
  onUpdateSpace?: (spaceId: string, patch: Partial<SpacingObject>, recordHistory?: boolean) => void;
  onDeleteSpace?: (spaceId: string) => void;
  isPrintView?: boolean;
}

export const PageSpacingLayer: React.FC<PageSpacingLayerProps> = ({
  pageIndex,
  pageWidth,
  pageHeight = 1123,
  pageMarginBottom = 36,
  staffMarginLeft,
  staffMarginRight,
  zoom = 1,
  systemPositions,
  spacingObjects,
  selection,
  toolMode,
  onSelectSpace,
  onAddSpace,
  onUpdateSpace,
  isPrintView = false,
}) => {
  // Active dragging handle state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    startY: number;
    initialAmount: number;
    currentAmount: number;
  } | null>(null);

  // Mousemove and mouseup listeners for interactive drag-resizing of vertical space
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const effectiveZoom = zoom > 0 ? zoom : 1;
      const deltaY = (e.clientY - dragRef.current.startY) / effectiveZoom;
      const newAmount = Math.max(0, Math.min(600, Math.round(dragRef.current.initialAmount + deltaY)));
      dragRef.current.currentAmount = newAmount;
      // Live layout update without creating hundreds of undo history steps
      onUpdateSpace?.(dragRef.current.id, { amount: newAmount }, false);
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        // Commit final resize position to undo/redo history
        onUpdateSpace?.(dragRef.current.id, { amount: dragRef.current.currentAmount }, true);
        dragRef.current = null;
        setActiveDragId(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, onUpdateSpace]);

  if (isPrintView) {
    // In print/PDF output, do not render editor handles/badges/outlines — only the pure canonical layout space
    return null;
  }

  const usableWidth = pageWidth - staffMarginLeft - staffMarginRight;
  const footerReservedHeight = 44;
  const bottomPrintableMargin = pageHeight - pageMarginBottom - footerReservedHeight;

  return (
    <g className="pianotastic-spacing-layer" pointerEvents="all">
      {systemPositions.map((pos) => {
        const { globalSysIdx, systemY, measureBlockHeight, lastMeasure } = pos;

        // Primary match by anchor measure ID; fallback by system index if unanchored
        const matchingSpace = spacingObjects.find((s) => {
          if (s.afterMeasureId) {
            return s.afterMeasureId === lastMeasure.id;
          }
          return s.systemIndex === globalSysIdx;
        });

        const isSelected =
          selection.selectionType === 'space' &&
          matchingSpace !== undefined &&
          selection.spacingObjectId === matchingSpace.id;

        const topY = systemY + measureBlockHeight;
        const maxVisualHeight = Math.max(16, bottomPrintableMargin - topY);
        const visualHeight = matchingSpace
          ? Math.min(Math.max(16, matchingSpace.amount), maxVisualHeight)
          : 28;

        return (
          <g key={`space-zone-p${pageIndex}-sys${globalSysIdx}-m${lastMeasure.id}`}>
            {matchingSpace ? (
              // An existing Spacing Object between systems
              <g
                className={`spacing-object-group ${isSelected ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSpace?.(matchingSpace.id);
                }}
              >
                {/* Background outline/tint when Space tool active or selected */}
                {(toolMode === 'space' || isSelected) && (
                  <rect
                    x={staffMarginLeft}
                    y={topY}
                    width={usableWidth}
                    height={visualHeight}
                    fill={isSelected ? 'rgba(2, 132, 199, 0.08)' : 'rgba(245, 158, 11, 0.05)'}
                    stroke={isSelected ? '#0284c7' : '#f59e0b'}
                    strokeWidth={isSelected ? 1.5 : 1}
                    strokeDasharray={isSelected ? 'none' : '4 3'}
                    rx={4}
                    className="cursor-pointer transition-colors"
                  />
                )}

                {/* Invisible hit-area if not selected and in another tool mode, allowing easy selection */}
                {toolMode !== 'space' && !isSelected && (
                  <rect
                    x={staffMarginLeft}
                    y={topY}
                    width={usableWidth}
                    height={Math.max(12, matchingSpace.amount)}
                    fill="transparent"
                    className="cursor-pointer"
                  />
                )}

                {/* Center Badge & Quick Steppers */}
                {(toolMode === 'space' || isSelected || activeDragId === matchingSpace.id) && (
                  <g transform={`translate(${pageWidth / 2}, ${topY + Math.min(visualHeight, 32) / 2})`}>
                    {/* Pill Background */}
                    <rect
                      x={-62}
                      y={-12}
                      width={124}
                      height={24}
                      rx={12}
                      fill={isSelected ? '#0284c7' : '#0f172a'}
                      className="shadow-sm cursor-pointer"
                    />

                    {/* Badge text */}
                    <text
                      x={0}
                      y={4}
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="'Plus Jakarta Sans', sans-serif"
                      textAnchor="middle"
                      className="pointer-events-none select-none"
                    >
                      ↕ {matchingSpace.amount} px
                    </text>

                    {/* Quick Stepper: [-] Button (-5px) */}
                    <g
                      transform="translate(-48, 0)"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = Math.max(0, (matchingSpace.amount || 0) - 5);
                        onUpdateSpace?.(matchingSpace.id, { amount: next }, true);
                      }}
                    >
                      <title>Decrease space by 5px</title>
                      <circle cx={0} cy={0} r={7.5} fill="rgba(255,255,255,0.25)" />
                      <text x={0} y={3.5} fill="#fff" fontSize="11" fontWeight="bold" textAnchor="middle">
                        -
                      </text>
                    </g>

                    {/* Quick Stepper: [+] Button (+5px) */}
                    <g
                      transform="translate(48, 0)"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = Math.min(600, (matchingSpace.amount || 0) + 5);
                        onUpdateSpace?.(matchingSpace.id, { amount: next }, true);
                      }}
                    >
                      <title>Increase space by 5px</title>
                      <circle cx={0} cy={0} r={7.5} fill="rgba(255,255,255,0.25)" />
                      <text x={0} y={3.5} fill="#fff" fontSize="11" fontWeight="bold" textAnchor="middle">
                        +
                      </text>
                    </g>
                  </g>
                )}

                {/* Interactive Drag Handle along the bottom border of the space */}
                {(toolMode === 'space' || isSelected) && (
                  <g
                    transform={`translate(${staffMarginLeft}, ${topY + matchingSpace.amount})`}
                    className="cursor-ns-resize"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      dragRef.current = {
                        id: matchingSpace.id,
                        startY: e.clientY,
                        initialAmount: matchingSpace.amount,
                        currentAmount: matchingSpace.amount,
                      };
                      setActiveDragId(matchingSpace.id);
                      onSelectSpace?.(matchingSpace.id);
                    }}
                  >
                    {/* Generous touch/click line for dragging */}
                    <rect
                      x={0}
                      y={-6}
                      width={usableWidth}
                      height={12}
                      fill="transparent"
                      className="cursor-ns-resize"
                    />
                    <line
                      x1={0}
                      y1={0}
                      x2={usableWidth}
                      y2={0}
                      stroke={isSelected ? '#0284c7' : '#cbd5e1'}
                      strokeWidth={isSelected ? 2 : 1.5}
                      strokeDasharray="3 3"
                    />
                    {/* Center Grip Handle */}
                    <rect
                      x={usableWidth / 2 - 18}
                      y={-4}
                      width={36}
                      height={8}
                      rx={4}
                      fill={isSelected ? '#0284c7' : '#94a3b8'}
                      className="shadow-2xs"
                    />
                  </g>
                )}
              </g>
            ) : (
              /* No space yet below this system: Show generous insert zone when Space Tool is active */
              toolMode === 'space' && (
                <g
                  className="space-insert-zone cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddSpace?.(lastMeasure.id, 30, globalSysIdx);
                  }}
                >
                  {/* Full-width transparent hit area for easy 1-click space creation */}
                  <rect
                    x={staffMarginLeft}
                    y={topY}
                    width={usableWidth}
                    height={Math.max(28, 24)}
                    fill="transparent"
                    className="cursor-pointer"
                  />
                  {/* Subtle dashed guide line across the line */}
                  <line
                    x1={staffMarginLeft}
                    y1={topY + 12}
                    x2={pageWidth - staffMarginRight}
                    y2={topY + 12}
                    stroke="#0284c7"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity="0.35"
                    className="group-hover:opacity-100 group-hover:stroke-sky-600 transition-opacity"
                  />
                  {/* Add Space button badge in center */}
                  <g transform={`translate(${pageWidth / 2}, ${topY + 12})`}>
                    <rect
                      x={-50}
                      y={-11}
                      width={100}
                      height={22}
                      rx={11}
                      fill="#ffffff"
                      stroke="#0284c7"
                      strokeWidth="1.5"
                      className="group-hover:fill-sky-50 transition-colors shadow-xs"
                    />
                    <text
                      x={0}
                      y={4}
                      fill="#0284c7"
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="'Plus Jakarta Sans', sans-serif"
                      textAnchor="middle"
                      className="pointer-events-none select-none"
                    >
                      + Insert Space
                    </text>
                  </g>
                </g>
              )
            )}
          </g>
        );
      })}
    </g>
  );
};
