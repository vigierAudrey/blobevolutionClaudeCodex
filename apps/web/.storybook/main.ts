import path from 'path';
import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {
      nextConfigPath: './next.config.mjs',
    },
  },
  docs: {
    autodocs: 'tag',
  },
  webpackFinal: async (baseConfig) => {
    const config = baseConfig;

    // Ensure webpack can resolve the package.json of ESM-only packages such as react-leaflet
    try {
      const reactLeafletEntry = require.resolve('react-leaflet');
      const reactLeafletDir = path.dirname(reactLeafletEntry);
      const reactLeafletPkg = path.join(reactLeafletDir, '..', 'package.json');

      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        'react-leaflet/package.json': reactLeafletPkg,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Impossible de résoudre react-leaflet pour Storybook', error);
    }

    // Encourage webpack to create smaller chunks to reduce the likelihood of size warnings
    const existingSplitChunks = config.optimization?.splitChunks ?? {};
    config.optimization = {
      ...(config.optimization ?? {}),
      splitChunks: {
        ...existingSplitChunks,
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 0,
        maxSize: 240000,
        cacheGroups: {
          ...(existingSplitChunks.cacheGroups ?? {}),
          leafletVendors: {
            test: /[\\/]node_modules[\\/](leaflet|react-leaflet)[\\/]/,
            name: 'leaflet-vendors',
            chunks: 'all',
            priority: 40,
            enforce: true,
          },
          firebaseVendors: {
            test: /[\\/]node_modules[\\/]firebase[\\/]/,
            name: 'firebase-vendors',
            chunks: 'all',
            priority: 30,
            enforce: true,
          },
        },
      },
    };

    config.performance = {
      ...(config.performance ?? {}),
      maxAssetSize: 350000,
      maxEntrypointSize: 450000,
    };

    return config;
  },
};

export default config;
