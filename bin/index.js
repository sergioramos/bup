#!/usr/bin/env node

const babel = require('rollup-plugin-babel');
const { default: babelrc } = require('babelrc-rollup');
const { exists, stat, writeFile, readFile } = require('mz/fs');
const paramCase = require('param-case');
const path = require('path');
const argv = require('yargs').argv;
const forEach = require('apr-for-each');
const parallel = require('apr-parallel');
const main = require('apr-main');
const readPkg = require('read-pkg');
const pkgDir = require('pkg-dir');
const { rollup } = require('rollup');
const makeDir = require('make-dir');

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
    entry: main,
    external,
    sourcemap: true,
    plugins: [
      babel(
        babelrc({
          config,
          addExternalHelpersPlugin: true
        })
      )
    ]
  });

  const write = fmt => async () => {
    const { code, map } = await bundle.generate({
      format: fmt,
      moduleId: pkg.name,
      moduleName: pkg.name,
      sourceMap: true
    });

    const file = await dest({ root, main, fmt, pkg });

    await makeDir(path.dirname(file));
    return writeFile(file, `${code}\n//# sourceMappingURL=${map.toUrl()}`);
  };

  return parallel([write('umd'), write('es'), write('iife')]);
};

const dest = async ({ root, main, fmt, pkg }) => {
  if (!pkg) {
    return path.join(process.cwd(), `dist/index.${fmt}.js`);
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

main(run());
