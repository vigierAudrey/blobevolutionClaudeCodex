# pnpm Configuration & Build Scripts Policy

## Package Manager

This project uses **pnpm@10.28.2** as the package manager for better dependency management and security.

```json
"packageManager": "pnpm@10.28.2"
```

## Installation

### Fresh Install

```bash
# Install pnpm if not already installed
npm install -g pnpm@10.28.2

# Or use corepack (recommended)
corepack enable
corepack prepare pnpm@10.28.2 --activate

# Install dependencies
pnpm install
```

### Post-Install

The `prepare` hook automatically:
1. Generates Prisma Client
2. Builds the database package

```bash
pnpm --filter @blobinfini/database generate
pnpm --filter @blobinfini/database build
```

## Development Workflows

### Local development (API + Web on host)

```bash
pnpm run dev:infra
pnpm run dev
```

`pnpm run dev` now performs a non-blocking Redis check on `localhost:6379`.
If Redis is not running, it prints a clear hint and continues startup.

### Full Docker development

```bash
pnpm run dev:all:docker
```

## Build Scripts Security

pnpm blocks build scripts by default for supply-chain security. Only specific packages are allowed to run build scripts.

### Ignored Build Dependencies

The following packages have their build scripts ignored (configured in `pnpm-workspace.yaml`):

```yaml
ignoredBuiltDependencies:
  - core-js
  - core-js-pure
  - protobufjs
```

These packages don't require native builds for this project.

### Native Dependencies (Historical)

**Previous setup (npm):** Used `bcrypt` (native C++ addon requiring compilation)

**Current setup (pnpm):** Uses `bcryptjs` (pure JavaScript)
- ✅ No native build required
- ✅ No platform-specific binaries
- ✅ Reproducible across all environments
- ✅ Works in CI without build tools
- ⚠️ Slightly slower than native bcrypt (acceptable for MVP)

### Other Native Packages

The following packages may have build scripts but are handled automatically by pnpm:
- `@prisma/client`, `@prisma/engines`, `prisma` - managed via `prepare` hook
- `esbuild`, `@swc/core` - compiled binaries downloaded automatically
- `sharp` - prebuilt binaries available for common platforms

## CI/CD Setup

### GitHub Actions / GitLab CI

```yaml
steps:
  - uses: actions/checkout@v4

  # Enable pnpm
  - uses: pnpm/action-setup@v2
    with:
      version: 10.28.2

  # Setup Node.js
  - uses: actions/setup-node@v4
    with:
      node-version: '22'
      cache: 'pnpm'

  # Install dependencies (frozen lockfile for reproducibility)
  - run: pnpm install --frozen-lockfile

  # Prisma generate is automatic via prepare hook

  # Type check
  - run: pnpm -r type-check

  # Tests
  - run: pnpm --filter @blobinfini/api test
```

### Key Points

1. **`--frozen-lockfile`**: Ensures exact versions from lockfile (fails if lockfile is outdated)
2. **Prisma generate**: Automatic via `prepare` hook, no manual step needed
3. **bcryptjs**: No build step required, pure JavaScript implementation

## Troubleshooting

### "Cannot find module 'bcrypt'"

This likely means you have old code still importing `bcrypt` instead of `bcryptjs`. Update all imports:

```typescript
// ❌ Old
import bcrypt from 'bcrypt';

// ✅ New
import bcrypt from 'bcryptjs';
```

### Prisma Client not found

Run the generate script:

```bash
pnpm run db:generate
```

Or manually:

```bash
pnpm --filter @blobinfini/database generate
```

### Build scripts not running

pnpm blocks build scripts by default. This is expected and secure. If you need to allow a new package's build script:

1. Add it to `ignoredBuiltDependencies` in `pnpm-workspace.yaml` (if build not needed)
2. Or ensure it's not in the ignored list (if build needed)
3. For native dependencies, prefer pure JavaScript alternatives (e.g., bcryptjs instead of bcrypt)

### "EADDRINUSE :::3002" while `kill-port` says no process

Use kernel-level diagnostics first (more reliable than `kill-port` for IPv6 listeners):

```bash
ss -lntp | rg ':(3002|4000)'
# fallback if ss is unavailable:
lsof -nP -iTCP:3002 -sTCP:LISTEN
```

For local dev scripts, use the repo helper that combines `ss`/`lsof` PID lookup with graceful then forced kill:

```bash
bash scripts/free-port.sh 3002
```

## Migration from npm

This project was migrated from npm workspaces to pnpm. Key changes:

1. **Lock file**: `package-lock.json` → `pnpm-lock.yaml`
2. **Scripts**: `npm run <script> --workspace <pkg>` → `pnpm --filter <pkg> <script>`
3. **Cache**: `~/.npm` → `~/.local/share/pnpm`
4. **Dependencies**: Hoisting behaves differently; all imports must be explicitly declared

## References

- [pnpm Documentation](https://pnpm.io/)
- [pnpm Workspace](https://pnpm.io/workspaces)
- [Build Scripts Security](https://pnpm.io/cli/install#--ignore-scripts)
