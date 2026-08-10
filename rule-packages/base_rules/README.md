# base_rules

The v1.1.0 base rule package contains the existing cross-scenario safety,
degradation, decision, and arbitration rules. Its content is mapped from the
legacy `packages/rules/data` files without changing decision semantics. It also
contains five formally validated evidence packets under `evidence/`.

Validate it with `npm run package:validate -- rule-packages/base_rules`.
Review a candidate with `npm run package:dry-run -- <package-dir|archive>`.
Installation requires explicit `--confirm`, stores an immutable version under
the local store, and updates its active pointer only after the Decision Harness
passes:

```text
npm run package:install -- <package-dir|archive> --store <store-dir> --confirm
npm run package:rollback -- base_rules --store <store-dir>
```

The default store is `data/private/rule-package-store`. It is local state, not a
remote registry. Runtime selection is explicit through
`EVIDRA_RULE_PACKAGE_DIR`; an active pointer never implies `latest`.
