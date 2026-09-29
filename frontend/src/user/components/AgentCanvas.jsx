import { Background, Controls, Handle, Position, ReactFlow, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';

const nodeTypes = ['input', 'copy', 'storyboard', 'image', 'video', 'voice', 'delivery'];

function CanvasNode({ data }) {
  return (
    <article className={`agent-canvas-node agent-canvas-node--${data.type} agent-canvas-node--${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <header><span>{data.type}</span><strong>{data.title}</strong></header>
      <p>{data.summary || '等待 Agent 写入结果'}</p>
      <footer><span>v{data.version}</span><span>{data.status}</span></footer>
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function toFlowNode(node) {
  return {
    id: node.id,
    type: 'agent',
    position: node.position,
    selected: false,
    data: {
      type: node.type,
      title: node.title,
      summary: node.summary,
      version: node.version,
      sourceNodeIds: node.sourceNodeIds,
      status: node.status,
      assetRef: node.assetRef || null
    }
  };
}

function toCanvas(nodes, edges, revision) {
  return {
    version: 1,
    revision,
    nodes: nodes.map(node => ({
      id: node.id,
      type: node.data.type,
      position: { x: node.position.x, y: node.position.y },
      title: node.data.title,
      version: node.data.version,
      sourceNodeIds: [...(node.data.sourceNodeIds || [])],
      status: node.data.status,
      summary: node.data.summary || '',
      ...(node.data.assetRef ? { assetRef: node.data.assetRef } : {})
    })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, relation: edge.data?.relation || 'reference' }))
  };
}

export function AgentCanvas({ canvas, onChange, onSelectionChange }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const currentCanvas = canvas || { version: 1, revision: 0, nodes: [], edges: [] };

  useEffect(() => {
    setNodes((currentCanvas.nodes || []).map(toFlowNode));
    setEdges((currentCanvas.edges || []).map(edge => ({ ...edge, data: { relation: edge.relation } })));
  }, [canvas]);

  const canvasNodeTypes = useMemo(() => ({ agent: CanvasNode }), []);

  function emitChange(nextNodes, nextEdges) {
    onChange?.(toCanvas(nextNodes, nextEdges, currentCanvas.revision));
  }

  function handleNodesChange(changes) {
    setNodes(current => {
      const next = applyNodeChanges(changes, current);
      emitChange(next, edges);
      const selectedIds = next.filter(node => node.selected).map(node => node.id);
      onSelectionChange?.(selectedIds);
      return next;
    });
  }

  function handleEdgesChange(changes) {
    setEdges(current => {
      const next = applyEdgeChanges(changes, current);
      emitChange(nodes, next);
      return next;
    });
  }

  if (!nodeTypes.length) return null;
  return (
    <div className="agent-canvas" aria-label="创作画布">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={canvasNodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        fitView
        minZoom={0.25}
        maxZoom={2}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
