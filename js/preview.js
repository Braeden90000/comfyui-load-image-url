import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "LoadImageFileOrURL.Preview",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "LoadImageFileOrURL") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);

            const node = this;
            const sourceWidget = this.widgets?.find(w => w.name === "source");
            const imageWidget = this.widgets?.find(w => w.name === "image");
            const urlWidget = this.widgets?.find(w => w.name === "url");
            if (!sourceWidget || !urlWidget) return;

            // Clear any inherited/cached images
            this.urlImg = null;
            this.fileImg = null;
            this.imgs = null;  // Clear native preview too
            this.srcMode = sourceWidget.value || "file";
            this._lastLoadedUrl = null;
            this._lastLoadedFile = null;

            const loadUrl = (url) => {
                if (!url || !url.startsWith("http")) { node.urlImg = null; return; }
                if (url === node._lastLoadedUrl && node.urlImg) return; // Already loaded
                node._lastLoadedUrl = url;
                const img = new Image();
                img.onload = () => { node.urlImg = img; app.graph.setDirtyCanvas(true, false); };
                img.onerror = () => { node.urlImg = null; };
                img.src = url;
            };

            const loadFile = (filename) => {
                if (!filename) { node.fileImg = null; return; }
                if (filename === node._lastLoadedFile && node.fileImg) return; // Already loaded
                node._lastLoadedFile = filename;
                const img = new Image();
                img.onload = () => { node.fileImg = img; app.graph.setDirtyCanvas(true, false); };
                img.onerror = () => { node.fileImg = null; };
                // Add cache-buster
                img.src = `/view?filename=${encodeURIComponent(filename)}&type=input&t=${Date.now()}`;
            };

            // Custom upload button
            const uploadWidget = this.addWidget("button", "choose file to upload", null, () => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/*";
                input.onchange = async () => {
                    if (!input.files || !input.files[0]) return;
                    const file = input.files[0];

                    const formData = new FormData();
                    formData.append("image", file);
                    formData.append("overwrite", "true");

                    try {
                        const resp = await fetch("/upload/image", {
                            method: "POST",
                            body: formData
                        });
                        const data = await resp.json();
                        if (data.name && imageWidget) {
                            // Add to dropdown options if not exists
                            if (!imageWidget.options.values.includes(data.name)) {
                                imageWidget.options.values.push(data.name);
                                imageWidget.options.values.sort();
                            }
                            // Select the uploaded file
                            imageWidget.value = data.name;
                            if (imageWidget.callback) imageWidget.callback(data.name);
                        }
                    } catch (e) {
                        console.error("Upload failed:", e);
                    }
                };
                input.click();
            });

            sourceWidget.callback = (v) => {
                node.srcMode = v;
                // Clear both previews when switching
                node.urlImg = null;
                node.fileImg = null;
                if (v === "url") loadUrl(urlWidget.value);
                if (v === "file" && imageWidget) loadFile(imageWidget.value);
                app.graph.setDirtyCanvas(true, false);
            };

            urlWidget.callback = (v) => {
                if (node.srcMode === "url") loadUrl(v);
            };

            if (imageWidget) {
                const origCallback = imageWidget.callback;
                imageWidget.callback = function(v) {
                    if (origCallback) origCallback.apply(this, arguments);
                    if (node.srcMode === "file") loadFile(v);
                };
            }

            // Only load preview for current mode on startup
            if (this.srcMode === "url" && urlWidget.value) {
                loadUrl(urlWidget.value);
            } else if (this.srcMode === "file" && imageWidget && imageWidget.value) {
                loadFile(imageWidget.value);
            }

            // Handle workflow load - clear and reload correct preview
            const onConfigure = this.onConfigure;
            this.onConfigure = function() {
                if (onConfigure) onConfigure.apply(this, arguments);
                // Clear cached images
                node.urlImg = null;
                node.fileImg = null;
                node.imgs = null;
                node._lastLoadedUrl = null;
                node._lastLoadedFile = null;
                // Update mode from widget
                node.srcMode = sourceWidget.value || "file";
                // Load correct preview after short delay
                setTimeout(() => {
                    if (node.srcMode === "url" && urlWidget.value) {
                        loadUrl(urlWidget.value);
                    } else if (node.srcMode === "file" && imageWidget && imageWidget.value) {
                        loadFile(imageWidget.value);
                    }
                }, 100);
            };
        };

        const onDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            if (onDraw) onDraw.apply(this, arguments);

            const img = this.srcMode === "url" ? this.urlImg : this.fileImg;
            if (!img) return;

            const y = 160;
            const maxW = this.size[0] - 20;
            const maxH = Math.max(this.size[1] - y - 25, 50);

            let w = img.width;
            let h = img.height;

            // Scale to fit width first
            if (w > maxW) {
                h = h * (maxW / w);
                w = maxW;
            }
            // Then scale to fit height if needed
            if (h > maxH) {
                w = w * (maxH / h);
                h = maxH;
            }

            const x = (this.size[0] - w) / 2;
            ctx.drawImage(img, x, y, w, h);
            ctx.fillStyle = "#aaa";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(img.width + " x " + img.height, this.size[0]/2, y + h + 15);
        };
    }
});
