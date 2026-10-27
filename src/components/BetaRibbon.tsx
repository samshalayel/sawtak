import React from 'react';

// Diagonal "trial version" ribbon across the top-left corner of every page (admin switch: betaRibbon). The header
// keeps that corner free while it shows, and clicks pass through the ribbon.

export const BetaRibbon: React.FC = () => (
  <div className="pointer-events-none fixed top-0 left-0 z-50 w-20 h-20 sm:w-32 sm:h-32 overflow-hidden" role="note" aria-label="نسخة تجريبية">
    {/* Fixed colours: the site theme remaps the palette (amber is the turquoise brand colour) */}
    <div className="absolute top-[21px] -left-[30px] sm:top-[27px] sm:-left-[38px] w-[120px] sm:w-[170px] -rotate-45 bg-gradient-to-r from-[#f59e0b] to-[#ea580c] text-[#ffffff] text-[9px] sm:text-xs font-extrabold text-center py-[3px] sm:py-1 shadow-lg">
      نسخة تجريبية
    </div>
  </div>
);
