// ESM loader：解析 @ 别名并即时转译 TS。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), '../src')

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = resolvePath(SRC, specifier.slice(2))
    return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)
    return { url: pathToFileURL(base + '.ts').href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const fileName = fileURLToPath(url)
    const source = readFileSync(fileName, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        isolatedModules: true,
      },
      fileName,
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
