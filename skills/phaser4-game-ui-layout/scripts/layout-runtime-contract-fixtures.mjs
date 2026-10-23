import { deriveLayoutExecutionPlans } from "./layout-execution.mjs";
import { collectLayoutRootBounds, isSyntheticLayoutRoot } from "./layout-root-bounds.mjs";
import { makeRuntimeTestObject, makeRuntimeTestScene } from "./layout-runtime-fixtures.mjs";
import { collectPhaserLayoutSnapshot } from "./phaser-layout-capture.mjs";

/**
 * 为合同门测试创建模拟采集，不能用作项目正式 Scene 的运行证据。
 * 所有模拟对象按冻结矩形放置，只验证入口确实消费完整采集结构。
 */
export function makeContractRuntimeTestCapture(nodes, context) {
  const { scene } = makeRuntimeTestScene();
  scene.sys.settings.key = context.scene_id;
  const plans = new Map(deriveLayoutExecutionPlans(nodes).map((item) => [item.layout_node_id, item.layout_execution]));
  const roots = collectLayoutRootBounds(context.viewport, { root_bounds: context.root_bounds, layout_nodes: nodes });
  const businessNodes = nodes.filter((node) => !isSyntheticLayoutRoot(node));
  const nodesById = new Map(businessNodes.map((node) => [node.layout_node_id, node]));
  const objects = new Map();
  const registry = new Map();
  const visiting = new Set();

  /** 按实际父级构造模拟 Container，避免以目标坐标冒充局部坐标。 */
  function buildObject(node) {
    if (objects.has(node.layout_node_id)) return objects.get(node.layout_node_id);
    if (visiting.has(node.layout_node_id)) throw new TypeError("合同测试夹具存在父级循环");
    visiting.add(node.layout_node_id);
    const parentNode = nodesById.get(node.parent_layout_node_id);
    const parent = parentNode ? buildObject(parentNode) : null;
    const bounds = node.target_bounds;
    const parentBounds = parentNode?.target_bounds ?? { x: 0, y: 0 };
    const object = makeRuntimeTestObject(scene, {
      type: "Container", parentContainer: parent,
      x: bounds.x - parentBounds.x, y: bounds.y - parentBounds.y,
      width: bounds.width, height: bounds.height,
    });
    if (parent) parent.list.push(object);
    const plan = plans.get(node.layout_node_id);
    objects.set(node.layout_node_id, object);
    registry.set(node.layout_node_id, {
      position_writes: [{ driver: plan.position_driver, writer_id: `fixture-position:${node.layout_node_id}` }],
      size_writes: [{ driver: plan.size_driver, writer_id: `fixture-size:${node.layout_node_id}` }],
      layout_bounds_space: "object-local",
      layout_bounds: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    });
    visiting.delete(node.layout_node_id);
    return object;
  }

  for (const node of businessNodes) buildObject(node);
  return collectPhaserLayoutSnapshot({
    scene, nodes, objects_by_id: objects, runtime_registry: registry,
    runtime_context: {
      capture_id: "fixture-capture", candidate_id: "fixture-candidate", batch_id: "fixture-batch",
      ...context, root_bounds: roots,
    },
    root_bindings: Object.fromEntries(["viewport", "safe-area"].map((id) => [id, {
      kind: "display-list", binding_id: "fixture-display-list", object: scene.sys.displayList,
    }])),
    world_to_layout: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  });
}
