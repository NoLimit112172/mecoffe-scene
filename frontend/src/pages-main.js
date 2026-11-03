import {createApp} from 'vue'
import PagesApp from './PagesApp.vue'
import router from './router/pages.js'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './style.css'

document.documentElement.classList.add('light-theme')
createApp(PagesApp).use(router).mount('#app')
