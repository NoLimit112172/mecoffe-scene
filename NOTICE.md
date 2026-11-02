# 第三方代码说明

`frontend/` 来自 [RUC-GSAI/YuLan-OneSim](https://github.com/RUC-GSAI/YuLan-OneSim) 的 `src/frontend`，提交 `9829d72`，按 Apache License 2.0 使用，许可证全文见 `YULAN_LICENSE`。美术素材（`frontend/public/assets`、`frontend/public/img`）同样来自该项目。

对上游文件的改动：

- `frontend/src/router/index.js`：新增 `/mecoffe` 路由；首页转到沙盘，原首页保留在 `/dashboard`。
- `frontend/src/App.vue`：在 `/mecoffe` 页面隐藏全局主题切换按钮。
- `frontend/package.json`：新增 `test` 脚本，`dev` 自动打开沙盘。
- `frontend/vite.config.js`：固定本地 5180 端口，仅在配置 API 地址时启用旧页面代理。

新增文件：`frontend/src/mecoffe/`、`frontend/src/views/MeCoffeScene.vue`、`frontend/tests/`、`frontend/public/mecoffe/`，以及仓库根目录下的 `adapter/`、`scene/`、启动脚本和 VS Code 配置。

`data/source/` 是团队 OASIS 模拟的运行导出，不属于 YuLan-OneSim。
