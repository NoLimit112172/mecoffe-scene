import {createApp} from 'vue'
import {createRouter, createWebHistory} from 'vue-router'
import PagesApp from './PagesApp.vue'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './style.css'

// 嵌入包只有地图、素材和配置预览入口，用户数据在登录后从同源 API 获取。
const router = createRouter({history: createWebHistory(import.meta.env.BASE_URL), routes: [
  {path: '/', component: () => import('./views/EmbeddedSceneEntry.vue')},
  {path: '/mecoffe3d', component: () => import('./views/EmbeddedSceneEntry.vue')},
  {path: '/mecoffe-gis', component: () => import('./views/EmbeddedSceneEntry.vue'), props:{view:'gis'}},
  {path: '/mecoffe3d/assets', component: () => import('./views/AssetLibrary.vue')},
  {path: '/licenses', name: 'licenses', component: () => import('./views/SourceLicenses.vue')},
]})
document.documentElement.classList.add('light-theme')
createApp(PagesApp).use(router).mount('#app')
