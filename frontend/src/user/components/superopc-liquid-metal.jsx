import { LiquidMetal } from '@paper-design/shaders-react';

/**
 * Agent 空状态使用的品牌动效。图片始终来自项目自身的黑/白 Logo，
 * 而不是把编辑器导出的 Base64 图片写进业务代码。
 */
export default function SuperOpcLiquidMetalLogo({ theme = 'dark', className = '' }) {
  const isLight = theme === 'light';

  return (
    <div className={`superopc-liquid-metal ${className}`.trim()} role="img" aria-label="一战晟铭">
      <LiquidMetal
        image={isLight ? '/assets/brand-logo-black.png' : '/assets/brand-logo-white.png'}
        speed={0.65}
        scale={0.6}
        rotation={0}
        offsetX={0}
        offsetY={0}
        fit="contain"
        colorBack="rgba(0, 0, 0, 0)"
        colorTint={isLight ? '#101218' : '#f5f7fb'}
        contour={0.4}
        distortion={0.07}
        softness={0.1}
        repetition={2}
        shiftRed={0.3}
        shiftBlue={0.3}
        angle={70}
        maxPixelCount={180000}
        webGlContextAttributes={{ alpha: true, preserveDrawingBuffer: false }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
