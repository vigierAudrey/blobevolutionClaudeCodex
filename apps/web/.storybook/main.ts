import path from 'path';
import type { StorybookConfig } from '@storybook/react-webpack5';
import type { Configuration as WebpackConfig } from 'webpack';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  staticDirs: ['../public'],
  webpackFinal: async (baseConfig: WebpackConfig): Promise<WebpackConfig> => {
    const config = baseConfig;

    // Ensure TypeScript files are transpiled with babel-loader
    config.module = config.module || { rules: [] };
    config.module.rules = config.module.rules || [];

    // Find and modify existing rules for TypeScript files
    const oneOfRule = config.module.rules?.find(
      (rule): rule is { oneOf: unknown[] } =>
        typeof rule === 'object' && rule !== null && 'oneOf' in rule
    );

    if (oneOfRule && Array.isArray(oneOfRule.oneOf)) {
      // Insert babel-loader before existing loaders
      oneOfRule.oneOf.unshift({
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                require.resolve('@babel/preset-env'),
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
                require.resolve('@babel/preset-typescript'),
              ],
            },
          },
        ],
      });
    } else {
      // Fallback: prepend babel-loader rule
      config.module.rules.unshift({
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                require.resolve('@babel/preset-env'),
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
                require.resolve('@babel/preset-typescript'),
              ],
            },
          },
        ],
      });
    }

    // Configure alias for Next.js modules, TypeScript paths, and assets
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      // Mock Next.js modules for Storybook
      'next/image': path.resolve(__dirname, './mocks/next-image.tsx'),
      'next/link': path.resolve(__dirname, './mocks/next-link.tsx'),
      'next/router': path.resolve(__dirname, './mocks/next-router.tsx'),
      // TypeScript path alias (@/ → apps/web/)
      '@': path.resolve(__dirname, '..'),
      // Map absolute asset paths to mock directory for CSS url() resolution
      '/hero-wallpaper.webp': path.resolve(__dirname, './app/hero-wallpaper.webp'),
      '/fonts/AdleryPro.woff': path.resolve(__dirname, './app/fonts/AdleryPro.woff'),
    };

    // Ensure webpack can resolve the package.json of ESM-only packages such as react-leaflet
    try {
      const reactLeafletEntry = require.resolve('react-leaflet');
      const reactLeafletDir = path.dirname(reactLeafletEntry);
      const reactLeafletPkg = path.join(reactLeafletDir, '..', 'package.json');

      if (config.resolve.alias && typeof config.resolve.alias === 'object' && !Array.isArray(config.resolve.alias)) {
        config.resolve.alias['react-leaflet/package.json'] = reactLeafletPkg;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Impossible de résoudre react-leaflet pour Storybook', error);
    }

    // Optimize bundle splitting to reduce chunk sizes
    const existingSplitChunks = config.optimization?.splitChunks;
    const existingCacheGroups =
      existingSplitChunks && typeof existingSplitChunks === 'object' && 'cacheGroups' in existingSplitChunks
        ? existingSplitChunks.cacheGroups
        : {};

    config.optimization = {
      ...(config.optimization ?? {}),
      splitChunks: {
        ...(typeof existingSplitChunks === 'object' ? existingSplitChunks : {}),
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 0,
        maxSize: 240000,
        cacheGroups: {
          ...(typeof existingCacheGroups === 'object' && existingCacheGroups !== null ? existingCacheGroups : {}),
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
