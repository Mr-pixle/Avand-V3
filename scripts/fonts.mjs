import { cpSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
for(const name of ['avand-black.svg','avand-white.svg'])copyFileSync(`src/assets/brand/${name}`,`web-dist/${name}`)
cpSync('public/auth', 'web-dist/auth', { recursive: true })
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'web-dist/board-assets/fonts', { recursive: true })
const index='web-dist/index.html'
let html=readFileSync(index,'utf8')
html=html.replace('<body>', '<link rel="icon" type="image/svg+xml" href="/avand-black.svg" media="(prefers-color-scheme: light)"><link rel="icon" type="image/svg+xml" href="/avand-white.svg" media="(prefers-color-scheme: dark)"><body>')
writeFileSync(index,html)
