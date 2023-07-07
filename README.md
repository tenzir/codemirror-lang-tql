# CodeMirror 6 language package for Tenzir Query Language (TQL)

### Generating the docs (horribly WIP)

#### Codegen

```fish
node scripts/index.js ~/code/tenzir/tenzir/web/docs/operators/ output.js
```

#### Format ugly js

```fish
prettier --write output.js
```
