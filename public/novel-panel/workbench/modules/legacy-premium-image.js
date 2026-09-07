(function () {
  'use strict';
  const registry = globalThis.__QIANTE_WORKBENCH_FEATURES__ ||= Object.create(null);
  registry['legacy:premium-image'] = {
    setMode(_context, mode) {
      const api = globalThis.__V77_PREMIUM_REFERENCE_API__ || globalThis.__V78_PREMIUM_REFERENCE_API__;
      if (!api?.setMode) throw new Error('精品图片功能加载失败，请点击重试。');
      return api.setMode(mode);
    },
    async v27GenerateAssetImage(context, mode) {
      if (context?.v28PremiumActive && !context.v28PremiumActive()) return;
      return context?.v27GenerateAssetImage?.(mode);
    },
    async v27DescribeAsset(context, mode) {
      if (context?.v28PremiumActive && !context.v28PremiumActive()) return;
      return context?.v27DescribeAsset?.(mode);
    }
  };
})();
