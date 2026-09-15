'use client';

import { FC } from 'react';
import { clsx } from 'clsx';

/**
 * Stand-in for a PDF wherever media is shown as a thumbnail. An <img> pointed
 * at a PDF just renders a broken image, which reads as a failed upload.
 */
export const PdfTile: FC<{ className?: string; compact?: boolean }> = ({
  className,
  compact,
}) => (
  <div
    className={clsx(
      'w-full h-full flex flex-col items-center justify-center gap-[4px] rounded-[4px] bg-newBgColorInner text-textColor',
      className
    )}
    title="PDF document"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={compact ? 'w-[18px] h-[18px]' : 'w-[40%] h-[40%] max-w-[64px]'}
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
    {!compact && <span className="text-[11px] font-semibold tracking-wide">PDF</span>}
  </div>
);
