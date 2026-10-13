# 运行态验证与最终交付

`runtime-validate` 只接受结构化 `spine-runtime-validation/1.0` JSON。报告必须声明真实 Phaser `SpineGameObject`、目标 Runtime 解析通过、SkeletonData 动画全集、每个动画找到并切换成功、Idle 默认循环且其他动作单次、纹理缺失/锚点漂移/Mesh 拉伸/闪烁/裁剪检查均通过，并提供真实 Bone/Slot/Animation/Atlas Page/Region 摘要。`target_runtime_parse` 还必须写出真实 producer、runtime package/version、command 或 URL、当前验证 run 的实际原始日志路径。

截图、浏览器日志、Runtime 原始日志和结构化报告都绑定同一个 `validation_run_id`，并检查实际文件、动画与运行结果；`build_binding` 和各 SHA/fingerprint 仅作可选追踪，不比较或阻断验收。

报告还必须包含诊断页 URL、浏览器验证记录、桌面截图和约 390px 移动端截图；每个文件都须可读取。截图不能替代结构化字段，任意一张图片也不能直接驱动 `finalize`。只有 `runtime-validate` 通过后才允许 `finalize`，`verify` 检查实际报告内容和证据，不复算或比较验收摘要。

`report` 生成 `spine-reskin-final/1.0`，包括批次数量/Region 数量、Atlas 完整性、Skeleton 升级结果、Bone/Slot/Attachment/Mesh/Animation 统计、Atlas/Page/Skeleton 哈希、全部 Cell 状态、网页地址、全动画切换结果、桌面/移动截图、验证结果和 `independent-validation-candidate` 或 `integrated-main-game` 交付模式。默认是独立验证候选，正式接入必须由外层 Phaser 工作流另行证明。
