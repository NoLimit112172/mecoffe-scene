import {fileURLToPath} from 'node:url'
import {pagesPreparation} from './pages/pages-plugin.mjs'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd())
    const pages=mode==='pages'
    const base=pages?(env.VITE_PAGES_BASE || '/mecoffe-scene/'):'/'
    const prepared=pages?pagesPreparation(fileURLToPath(new URL('.',import.meta.url)),base):null
    const apiBaseUrl = pages ? undefined : env.VITE_API_BASE_URL?.trim()
    return {
        base,
        // Local VITE_* configuration must never be serialized into public JS.
        envPrefix: pages ? 'MECOFFE_PUBLIC_' : 'VITE_',
        publicDir:pages?false:'public',
        resolve:{alias:prepared?.aliases || []},
        plugins: [vue(),...(prepared?[prepared.plugin]:[])],
        server: {
            host: '127.0.0.1',
            port: 5180,
            strictPort: true,
            // F5 的 Chrome 调试配置负责开页；npm run dev 单独传 --open。
            open: false,
            // MeCoffe 三种展示模式不依赖后端。仅显式配置时启用旧页面的 API 代理。
            ...(apiBaseUrl ? { proxy: {
                '/api': {
                    target: apiBaseUrl,
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api/, ''),
                },
            } } : {}),
        },
        define: {
            '__API_PROXY__': JSON.stringify({
                baseUrl: apiBaseUrl,
            })
        }
    }
})
