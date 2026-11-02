import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd())
    const apiBaseUrl = env.VITE_API_BASE_URL?.trim()
    return {
        plugins: [vue()],
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
