# MadeMe 服务插件 v0.1

为 KMH Web 编写第一个"服务插件"——MadeMe 插件：安装并启用后，侧边栏按现有样式出现 MadeMe 入口（不改图标轨、不改侧栏交互），点击在主区内嵌打开 MadeMe 网页，同时把 MadeMe 服务的能力接入助手，会话中可直接调用。插件以可独立导出、复用的插件包形式开发（可导出式插件模式），不确定的配置项（如服务地址、助手接入地址）都收在插件详情里填写；MadeMe 网页是否允许被内嵌先按允许处理，实测不行再调整服务端。MadeMe 插件是后续服务插件（知识、Meloop、x-infra 等）的模板。本版本不改侧栏与图标轨的任何现有行为（hover 展开、钉住、标签轨等见二期 spec `workbench-rail-sidebar-v0.1`）；不做手动添加网页入口、多服务分屏；同一服务多账号登录不支持（浏览器内嵌网页的通用限制）。

## feat01: 侧边栏出现 MadeMe 入口

用户安装 MadeMe 插件后，在现有侧边栏中看到并识别 MadeMe 入口。

场景1: 启用后可见
- GIVEN 用户已安装并启用 MadeMe 插件
- WHEN 用户打开或刷新 KMH Web
- THEN 侧边栏出现 MadeMe 入口：展开态显示插件自带的图标和名称"MadeMe"，收起态显示图标，样式与现有侧栏条目一致

场景2: 悬停提示
- GIVEN 侧边栏处于收起状态
- WHEN 鼠标悬停在 MadeMe 图标上
- THEN 显示"MadeMe"名称提示

场景3: 停用即消失
- GIVEN MadeMe 插件已启用
- WHEN 用户停用或卸载该插件
- THEN MadeMe 入口从侧边栏消失；若其网页正在主区显示，主区回到会话

场景4: 状态记忆
- GIVEN 用户正在查看 MadeMe 网页（入口处于选中态）
- WHEN 用户刷新页面
- THEN 入口仍在，且主区恢复显示 MadeMe 网页

## feat02: 点击内嵌打开 MadeMe 网页

用户点击侧边栏的 MadeMe 入口，在主区内嵌打开 MadeMe 服务网页，与 KMH 会话互不干扰。

场景1: 打开 MadeMe
- GIVEN MadeMe 插件已启用，主区显示会话
- WHEN 用户点击 MadeMe 入口
- THEN 主区从会话切换为 MadeMe 网页（地址取插件配置），首次打开显示加载中，入口呈选中态

场景2: 返回会话后再回来
- GIVEN 主区显示 MadeMe 网页
- WHEN 用户通过新建会话或点击会话列表回到会话，之后再次点击 MadeMe 入口
- THEN 主区回到 MadeMe 网页，按当前服务地址重新加载（WebKit/Safari 系浏览器搬移 iframe 会重载内容，页面内状态不保留；服务登录态由浏览器保留）

场景3: 登录状态独立
- GIVEN MadeMe 网页需要登录
- WHEN 用户在 MadeMe 网页内登录或退出
- THEN KMH 会话与其他内容不受影响；MadeMe 的登录状态在其网页内保持，刷新 KMH Web 后仍处于已登录

场景4: 服务无法打开
- GIVEN MadeMe 服务未启动，或配置的地址无法访问、拒绝被内嵌
- WHEN 用户点击 MadeMe 入口
- THEN 主区切入 MadeMe 面板并显示加载中；若约 8 秒仍未加载出来，显示"MadeMe 可能无法内嵌打开"的提示（可能原因：服务未运行或地址无效），并提供"在系统浏览器中打开"按钮
- THEN 面板工具栏始终提供"在系统浏览器中打开"按钮，不必等提示出现

场景5: 更改服务地址
- GIVEN 用户在插件设置中修改了 MadeMe 服务地址并保存
- WHEN 再次点击 MadeMe 入口
- THEN 按新地址加载网页

## feat03: 助手使用 MadeMe 工具

MadeMe 知识库的能力接入助手，用户在会话中让助手操作 MadeMe。接入由 kmh-web profile 的 `mcp-mademe` 实例承担（拉起 MadeMe-web 自带的 stdio MCP 服务），不经本插件装配；配置落点、核对与停用见 [Web 配置 · MadeMe 工具](../../../profiles/kmh-web/README.md#mademe-工具)。

场景1: 会话中调用
- GIVEN profile 已声明 mcp-mademe 实例，且 MadeMe-web 的 MCP 入口与 mademe-cli 就位
- WHEN 用户在会话中要求助手操作 MadeMe（如查询或写入内容）
- THEN 助手可以调用 MadeMe 提供的工具完成任务；具体提供哪些工具由 MadeMe 的 MCP 服务自身定义

场景2: 入口或 CLI 缺失
- GIVEN profile 已声明 mcp-mademe 实例，但 MCP 入口文件或 mademe-cli 不存在
- WHEN 用户在会话中让助手使用 MadeMe 工具
- THEN 助手暂无 MadeMe 工具可用（工具不出现，无法调用）；在重连窗口内补齐文件即自动出现，超过窗口后重启 Web 恢复

场景3: 停用实例
- GIVEN 已从 profile 移除 mcp-mademe 实例并重启 Web
- WHEN 用户在会话中要求助手操作 MadeMe
- THEN 助手不再有 MadeMe 工具可用；停用 @kmh/mademe 插件本身不影响工具，网页内嵌打开功能也不受工具接入状态影响

## feat04: 在插件详情中填写配置

用户在 MadeMe 插件详情中查看和填写不确定的配置项，并可测试服务连通性。

场景1: 查看与修改
- GIVEN MadeMe 插件已安装
- WHEN 用户打开 MadeMe 插件详情
- THEN 详情页直接显示全部配置项（即 MadeMe 服务地址），每项带默认值，可修改并保存；服务地址修改后，下次打开按新地址加载

场景2: 无效地址
- WHEN 用户填入格式无效的地址并保存
- THEN 提示"地址格式不正确"且不保存

场景3: 测试服务连通性
- GIVEN 插件详情的配置项显示中，服务地址为格式有效的地址（已保存或草稿均可）
- WHEN 用户点击"测试连接"按钮
- THEN 显示探测中状态，数秒内给出结果：可达（含耗时）或不可达/超时的提示
