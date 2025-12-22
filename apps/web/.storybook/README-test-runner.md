# Storybook Test Runner Configuration

## Jest Config Override

`test-runner-jest.config.js` provides custom Jest configuration for the Storybook test-runner to fix monorepo-specific issues.

### Fixes

1. **Duplicate Manual Mock Error**: Prevents Jest from scanning `apps/api/dist/` which contains duplicate mocks from TypeScript compilation.
   - Without this config: `jest-haste-map: duplicate manual mock found`
   - Solution: Added `modulePathIgnorePatterns` and `testPathIgnorePatterns` to exclude `apps/api/`

2. **Monorepo Scoping**: Limits Jest to only scan `apps/web` directory.
   - Avoids scanning entire monorepo (root, api, database)
   - Improves test performance and reliability

##Known Issue: Node 22 + nyc/istanbul Incompatibility

**Status**: Test runner currently fails on Node 22.19.0 with:
```
TypeError [ERR_INVALID_ARG_TYPE]: The "original" argument must be of type function.
Received an instance of Object at promisify (node:internal/util:444:3)
at Object.<anonymous> (istanbul-lib-processinfo/index.js:10:16)
```

**Cause**:
- `glob@10.x` changed API from callback-based function to ESM module with named exports
- `nyc@15.1.0` and `istanbul-lib-processinfo` use `promisify(require('glob'))` which fails on glob@10
- These packages are transitive dependencies of `@storybook/test-runner`

**Workaround**:
Use Node 20.x for running test-storybook:
```bash
nvm use 20  # or equivalent
npm -w apps/web run test:storybook
```

**Permanent Fix** (future):
- Wait for @storybook/test-runner to upgrade to nyc@17+ (supports glob@10)
- OR downgrade glob to 9.x globally (not recommended, breaks other packages)
- OR use alternative test runner that doesn't depend on nyc/istanbul

##Usage

```bash
# Build and test stories
npm run storybook:build
npm run storybook:test
```

The test-runner automatically picks up `test-runner-jest.config.js` from the workspace root.
