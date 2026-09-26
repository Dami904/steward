# Migrating an existing repo from npm to pnpm

1. Install pnpm if you haven't: `corepack enable` (ships with Node 20+,
   handles version pinning for you) or `npm install -g pnpm`.
2. From the repo root, with the existing `package-lock.json` still in
   place: `pnpm import`. This converts your npm lockfile into
   `pnpm-lock.yaml` so dependency versions don't silently drift during the
   switch.
3. Delete `node_modules` and `package-lock.json`:
   ```bash
   rm -rf node_modules package-lock.json
   pnpm install
   ```
4. Pin the package manager in `package.json` so CI and every contributor
   resolve to the same version:
   ```json
   {
     "packageManager": "pnpm@9.12.0"
   }
   ```
   (Check `pnpm --version` locally and use that, or whatever you want to
   standardize on.)
5. Update every CI workflow: swap `npm ci` for
   `pnpm install --frozen-lockfile`, and add the `pnpm/action-setup` step
   before `actions/setup-node` (see `ci.yml` in this folder).
6. Update the README: grep for `npm install`, `npm run`, `npx` and replace
   with `pnpm install`, `pnpm run` (or just `pnpm <script>`), `pnpm dlx`.
   Do this in the same commit as the migration — a README that still says
   `npm install` right after a pnpm migration is the first thing that
   breaks a cold reviewer's setup.
7. If this is (or is becoming) a monorepo, add `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   ```
   and reference workspace packages with `workspace:*` in each
   package.json's dependencies instead of a version range.
8. Commit `pnpm-lock.yaml`, verify `.gitignore` still ignores
   `node_modules`, and confirm nothing else in the repo (a Dockerfile, a
   deploy script) still hardcodes `npm`.
