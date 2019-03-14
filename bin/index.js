#!/usr/bin/env node

const { rollup } = require('rollup');
const { default: babelrc } = require('babelrc-rollup');
const babel = require('rollup-plugin-babel');
const nodeResolve = require('rollup-plugin-node-resolve');
const commonjs = require('rollup-plugin-commonjs');
const json = require('rollup-plugin-json');

const { exists, stat, writeFile, readFile } = require('mz/fs');
const paramCase = require('param-case');
const path = require('path');
const { argv } = require('yargs');
const { default: forEach } = require('apr-for-each');
const parallel = require('apr-parallel');
const debounce = require('lodash.debounce');
const main = require('apr-main');
const readPkg = require('read-pkg');
const pkgDir = require('pkg-dir');
const camelCase = require('camel-case');
const makeDir = require('make-dir');
const chokidar = require('chokidar');

const destName = argv['dest-name'];
const watchPattern = argv.watch;

const babelConfig = async ({ root, pkg }) => {
  const dotrc = path.join(root, '.babelrc');
  const dotrcExists = await exists(dotrc);

  if (dotrcExists) {
    const str = await readFile(dotrc, 'utf-8');
    return JSON.parse(str);
  }

  const dotjson = path.join(root, '.babelrc.json');
  const dotjsonExists = await exists(dotjson);

  if (dotjsonExists) {
    const str = await readFile(dotjson, 'utf-8');
    return JSON.parse(str);
  }

  return pkg.babel || {};
};

const build = async ({ pkg, main, external, root }) => {
  const config = await babelConfig({ root, pkg });

  const bundle = await rollup({
    input: main,
    external,
    plugins: [
      babel(
        babelrc({
          config,
          addExternalHelpersPlugin: false
        })
      ),
      json(),
      nodeResolve(),
      commonjs({
        ignoreGlobal: true
      })
    ]
  });

  const write = fmt => async () => {
    const { output = [] } = await bundle.generate({
      format: fmt,
      amd: { id: pkg.name },
      name: fmt === 'iife' ? camelCase(pkg.name) : pkg.name,
      sourcemap: true
    });

    await forEach(output, async ({ code, map }) => {
      const file = await dest({ root, main, fmt, pkg });

      await makeDir(path.dirname(file));
      return writeFile(file, `${code}\n//# sourceMappingURL=${map.toUrl()}`);
    });
  };

  return parallel([write('umd'), write('es'), write('iife')]);
};

const dest = async ({ root, main, fmt, pkg }) => {
  if (!pkg) {
    return path.join(process.cwd(), `dist/${destName || 'index'}.${fmt}.js`);
  }

  if (destName) {
    return path.join(root, `dist/${paramCase(destName)}.${fmt}.js`);
  }

  if (!pkg.entry || path.resolve(pkg.entry) === path.resolve(main)) {
    return path.join(root, `dist/${paramCase(pkg.name)}.${fmt}.js`);
  }

  const name = path.basename(main, path.extname(main));
  return path.join(process.cwd(), `dist/${paramCase(name)}.${fmt}.js`);
};

const getPkg = async dir => {
  if (!dir) {
    return;
  }

  const pathanme = path.join(dir, 'package.json');
  const hasPkg = await exists(pathanme);

  if (!hasPkg) {
    return;
  }

  return readPkg(pathanme);
};

const pkgEntry = async location => {
  const root = await pkgDir(location);
  const pkg = await getPkg(root);
  const pkgEntry = path.resolve(root, pkg.entry || 'index.js');
  const pkgEntryExists = await exists(pkgEntry);
  return pkgEntryExists ? pkgEntry : null;
};

const entry = async location => {
  const isDir = (await stat(location)).isDirectory();

  if (!isDir) {
    return location;
  }

  const index = path.join(location, 'index.js');
  const indexExists = await exists(index);

  if (indexExists) {
    return index;
  }

  const main = await pkgEntry(location);

  if (main) {
    return main;
  }

  throw new Error("Can't resolve entrypoint");
};

const external = async ({ pkg }) => {
  return ['dependencies', 'devDependencies', 'peerDependencies'].reduce(
    (deps, name) => Object.keys(pkg[name] || {}).concat(deps),
    []
  );
};

const run = async () => {
  // eslint-disable-next-line no-console
  console.log('-> Running bup');

  if (!argv._.length) {
    argv._.push('.');
  }

  return forEach(argv._, async arg => {
    const location = path.resolve(process.cwd(), arg);
    const main = await entry(location);
    const root = await pkgDir(main);
    const pkg = await getPkg(root);

    const ctx = {
      main,
      location,
      root,
      pkg
    };

    return build(
      Object.assign(ctx, {
        external: await external(ctx)
      })
    );
  });
};

const watch = async () =>
  chokidar
    .watch(watchPattern)
    // eslint-disable-next-line no-console
    .on('all', debounce(() => run().catch(err => console.error(err)), 500));

main(watchPattern ? watch() : run());
