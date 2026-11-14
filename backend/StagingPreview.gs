// Optional read-only layout preview in the private staging project.
// Add a staging-only doGet branch for action=layout; never ship it to production.
function stagingLayoutPreview_() {
  stagingAssert_();
  return HtmlService.createHtmlOutput(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px;background:#e7e9ed;font:16px Arial,sans-serif}button{padding:10px;margin:6px}iframe{display:block;background:white;border:1px solid #888;height:844px;max-width:100%}</style></head><body><h1>Ignite Living — responsive layout check</h1><p>Live public page inside a fixed-width frame. Read-only checks only. This is desktop Chrome rendering, not a real phone.</p><button onclick="document.getElementById('preview').style.width='390px'">390 px phone width</button><button onclick="document.getElementById('preview').style.width='768px'">768 px tablet width</button><iframe id="preview" title="Ignite Living responsive preview" src="https://living.igniteinnov.com/" style="width:390px"></iframe></body></html>`).setTitle('Ignite Living STAGING — responsive checks');
}
