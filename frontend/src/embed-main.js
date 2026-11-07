import {createApp} from 'vue'
import {createRouter, createWebHistory} from 'vue-router'
import PagesApp from './PagesApp.vue'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './style.css'

// 嵌入包只有地图、素材和配置预览入口，用户数据在登录后从同源 API 获取。
const router = createRouter({history: createWebHistory(import.meta.env.BASE_URL), routes: [
  {path: '/', redirect: {path: '/mecoffe3d', query: {preview: 'local'}}},
  {path: '/mecoffe3d', component: () => import('./views/MeCoffe3DEntry.vue')},
  {path: '/mecoffe-gis', component: () => import('./views/MeCoffeGisEntry.vue')},
  {path: '/mecoffe3d/assets', component: () => import('./views/AssetLibrary.vue')},
  {path: '/licenses', name: 'licenses', component: () => import('./views/SourceLicenses.vue')},
]})
router.beforeEach(to => {
  if (['/mecoffe3d', '/mecoffe-gis'].includes(to.path) && !to.query.session && !to.query.config && to.query.preview !== 'local') {
    return {path: to.path, query: {preview: 'local'}, replace: true}
  }
})
document.documentElement.classList.add('light-theme')
createApp(PagesApp).use(router).mount('#app')
