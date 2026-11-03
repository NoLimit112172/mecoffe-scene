# Rocketbox 全人物库与运行入口交付记录

本轮把原四模型试用扩展为全部独立标准人形，继续在 `feat/asset-library` 本地提交，不 push。此前的 [四模型试用记录](rocketbox-trial.md) 保留为历史记录；当前数量、贴图规格和加载方式以本文及 manifest 为准。

## 怎么运行

1. 在 VS Code 打开项目根目录，F5 选择 **MeCoffe：三维校园沙盘**。已有服务运行时，直接访问 <http://127.0.0.1:5180/mecoffe3d>；旧页面刷新一次即可读取新 manifest。
2. 顶部默认 **写实人物 / 全部人形**。点击底部 **看人物行走**，会跳到当前数据中的首笔购买事件并播放去店和返回；**播放**则按完整时间线回放。右上角 **人物特写** 放大所选人物，**全景**恢复校园视角。
3. 通过 **外观** 可切换全部、成年人便装、职业装、儿童。这里只替换外观池，人物编号、画像、订单、位置、路线和回放游标保持不变。分类是模型分类，不表示模拟主体的真实年龄、职业或长相。
4. 点击 **人物素材库**，或访问 <http://127.0.0.1:5180/mecoffe3d/assets?source=rocketbox>。115个人物各有独立卡片，支持分类、搜索、10页浏览、拖动旋转以及站立/行走/持杯预览。

静态关系网络没有行为事件，因此“看人物行走”和时间线播放保持禁用。新版演示和历史回放继续使用原有数据模式，不需要 API、Blender 或额外后端。

## 素材范围与大小

| 内容 | 数量 |
| --- | ---: |
| 成年人 | 40 |
| 儿童 | 4 |
| 职业人物 | 71 |
| 独立人形 / 原始标准 FBX | **115** |
| 运行 PNG | **357** |
| FBX + PNG 实际字节 | **257,228,579 B，约245.31 MiB** |

包含该固定版本全部115个独立标准人形；没有把117个 facial 导出重复计算为新人物，也不包含25个动物模型、471个动作FBX或Max制作源。官方目录没有单独的老年人分类，不另造“老年人数量”。原始FBX总计67,855,520字节。

素材库现在共有 **189个原型**，其中人物120个：115个写实人物卡片、1个写实全集入口及4个已有风格原型。Rocketbox来源原型116个。默认人物筛选只列115张独立卡片；全集入口仍可通过搜索访问。

## 来源、许可与转换证据

所有标准FBX来自 [Microsoft Rocketbox 官方仓库](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9)，固定版本 `0943055db6ec570bcef9f2c8b41c9e5467c808f9`，使用该版本根目录 **MIT License**。115个FBX均保留官方原字节，核对了官方Git blob SHA1和实际SHA256。原许可、README与逐文件来源保存在 `frontend/public/mecoffe/assets3d/rocketbox/`。

贴图有两条明示的来源路径：

- **47个模型、163张贴图**：从官方原TGA转换，原文件已下载并核对Git blob、尺寸与SHA256。
- **68个模型、194张贴图**：使用 [openOMSI 的 avatars-1 MIT 派生包](https://github.com/openOMSI-org/openOMSI/releases/tag/avatars-1) 中与模型/原图名称对应的JPEG/PNG。选定ZIP条目按范围获取并检查CRC32、解压尺寸、实际图像SHA256，再缩小输出PNG。该包只提供贴图，本项目仍使用独立核验的原始标准FBX，不使用其facial FBX。

派生路径不会声称原TGA已下载或本地验证；manifest将其 `source_sha256` 留空，并设 `source_git_blob_locally_verified=false`，另记发布包、条目、CRC、实际派生图SHA256及转换信息。发布包整体SHA256仅为GitHub发布元数据，**完整ZIP没有下载验SHA**。JPEG已是有损中间图，转PNG不等于恢复原TGA。发布包的原LICENSE/CREDITS与本地来源说明在 `rocketbox/derivatives/openomsi/` 中保留。

所有运行PNG采用Pillow LANCZOS：头部/共用脸部图集最长边1024，身体、装备、透明部件最长边512；保留RGB/RGBA与alpha。没有下载法线、高光贴图或动作包。动作由程序驱动原带权重骨架，不称为动作捕捉；儿童模型使用Bip02骨名，运行时兼容归一化别名。

## 加载与展示

场景从完整manifest读取模型。全部人形模式为100个主体稳定分配100种不同外观；同一套人口的输入顺序变化不会改变分配。单独类别不足100款时会稳定复用该类别原型，不修改主体身份。

默认只加载当前展示可见的人物，页面显示就绪数量。全局最多3个模型加载任务，未就绪者临时使用YuLan立体外观，加载后逐人替换；不同时绘制两种身体。离开可见范围后最多保留8个隐藏预热实例，其余释放骨架与模型引用。素材库每页12张卡片，只为画面内的卡片创建三维预览；换页释放旧视图并取消过期准备任务。

高度8.5、半径3是为了全景辨认而采用的展示尺度，不是实际身高。原YuLan建筑、OSM几何、八个地点映射、原始A*路网、人物关系、订单与三种数据模式均保留，顶部OASIS没有位置数据的提示保持原文。`/mecoffe`二维页面和VS Code启动配置未改。

## 重建与检查

正常运行直接使用已入库的FBX/PNG/manifest，不依赖 `logs/` 或外部模型服务器。来源准备脚本是维护工具，包含下载与转换，不是启动前置条件：

```powershell
# 盘点固定官方版本，重建被忽略的准备清单
python -X utf8 adapter/rocketbox_assets.py --inventory-only

# 完全从官方原TGA重新生成全部素材；需要联网下载数GB源文件
python -X utf8 adapter/rocketbox_assets.py --workers 6

# 已有盘点/标准FBX时，可用固定派生索引准备91人范围内的贴图
# 保留已有完整记录；不会独自发布部分manifest
python -X utf8 adapter/rocketbox_derived_textures.py

# 对完整准备记录核验后原子发布；源TGA缓存需保留以验证原来源
python -X utf8 adapter/rocketbox_assets.py --aggregate-only

# 重新检查实际骨骼/UV/权重，重建素材目录
node adapter/rocketbox_diagnose.mjs
python -X utf8 adapter/build_asset_catalog.py
```

固定派生ZIP索引已版本化到 `adapter/resources/rocketbox-openomsi-index.json`，不依赖忽略目录中的一次性完整audit。索引包含91个人物、258个对应颜色条目范围/压缩方法/CRC及原许可文本，无凭据或临时签名URL。导入脚本 `--index`（兼容 `--audit`）可显式覆盖。离线测试核对索引来源、数量、范围、路径和许可CRC。

维护脚本会写每个已完成模型的独立记录，全部115项校验通过后才原子替换manifest；下载中断不会发布半套库。大尺寸原TGA与下载分片只在被忽略的缓存中，未提交。

## 验证结果

| 最终命令 | 结果 |
| --- | --- |
| 根目录 `python -X utf8 -m unittest discover -s adapter -v` | **69/69通过**，退出码0 |
| frontend目录 `npm test` | **183/183通过**，退出码0 |
| frontend目录 `npm run build` | **成功**，退出码0，18.76秒 |
| `node logs/asset-library/rocketbox-full-browser.cjs` | **成功**，115个模型实际渲染，页面错误0 |
| `git diff --check` | 通过 |

提交号可用 `git log -1 --format=%h -- docs/rocketbox-library.md` 查询。验证证据保留在本机 `logs/asset-library/`，不进入源码提交：

- `rocketbox-all-python-tests.txt`：全部Python适配器测试，包含115FBX/357PNG来源、哈希、尺寸与派生索引检查。
- `rocketbox-all-frontend-tests.txt`：全部前端测试，包含全人口稳定选型、儿童骨架、加载并发、可见性/预热释放、分类切换、过期卡片取消、YuLan回退和分页边界。
- `rocketbox-all-build.txt`：完整生产构建。现有大包及CharacterFactory混合导入提示保留，不影响构建退出。
- `rocketbox-all-envelopes.json`：115个真实模型×16姿态的实际蒙皮顶点包络检查，缺失关键骨/高度/半径失败均为0。
- `rocketbox-full-browser.json`：Chrome1600×1000真实页面，115款逐个渲染、10页、三分类、三预览动作，错误0；默认26个可见模型就绪，100个主体分配100种外观；一键行走触发原有购买事件，三种数据模式/四风格/高低画质/暂停通过；历史第2天现场79人在途、85个可见人物已就绪，现场碰撞0、不可达0。模型/贴图请求全部为本机地址，无TGA或外部模型请求。

实际页面截图：

- `logs/asset-library/rocketbox-full-overview.png`：校园全景与115款人物库状态。
- `logs/asset-library/rocketbox-full-walking.png`：首笔购买触发行走。
- `logs/asset-library/rocketbox-full-closeup.png`：写实人物近景。
- `logs/asset-library/rocketbox-library.png`：人物库115款与分页预览。
- `logs/asset-library/rocketbox-children.png`：儿童分类及动作选择。

## 已知限制

Rocketbox是原有年代的人物网格与服装，贴图已压缩；并非现代扫描级/PBR数字人，也不是团队主体真实肖像。步态和持杯为程序骨骼动作，没有面部表情、口型或动作捕捉。职业装备属于原模型外观，不表示校园发生相应行为。全景为辨识而放大人物；外观类别不会参与消费者决策。高并发行走需要更多模型与GPU资源，按需加载降低初始开销，不保证任意机器的帧率。
