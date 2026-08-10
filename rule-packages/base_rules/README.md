# base_rules

The v1.0.0 base rule package contains the existing cross-scenario safety,
degradation, decision, and arbitration rules. Its content is mapped from the
legacy `packages/rules/data` files without changing their JSON or runtime
semantics.

Validate it with `node scripts/validate-rule-packages.js`. R0 defines the
package boundary only; install archives, active pointers, rollback, review
workflow, and remote registries are intentionally out of scope.
