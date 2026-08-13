/* =================================================================
   HF Deploy — browser-side one-click deploy to Hugging Face Spaces.

   The user pastes their HF write token once. The token is saved to
   localStorage (NOT sent anywhere except huggingface.co) and used to:
     1. Validate against /api/whoami-v2
     2. Create a new Space via /api/repos/create
     3. Upload files via PUT /api/spaces/{owner}/{name}/upload/main/{path}
     4. Optionally deploy any HF model as a generated Gradio app.

   No backend. All calls go directly from the browser to HF.
   ================================================================= */

(function () {
  'use strict';

  var TOKEN_KEY = 'gpd:hf-token';
  var USER_KEY  = 'gpd:hf-user';

  var state = {
    token: null,
    user: null,    // { name, fullname, avatarUrl }
    validating: false
  };

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }
  function writeToken(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function readUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeUser(u) {
    try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch (e) {}
  }

  function loadFromStorage() {
    state.token = readToken();
    state.user  = readUser();
  }
  loadFromStorage();

  function isValidTokenFormat(t) {
    return typeof t === 'string' && /^hf_[A-Za-z0-9]{20,}$/.test(t.trim());
  }

  /* ---- whoami-v2: validate token + get user ---- */
  async function whoami(token) {
    var resp = await fetch('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!resp.ok) {
      var body = '';
      try { body = await resp.text(); } catch (e) {}
      throw new Error('Token validation failed: ' + resp.status + (body ? ' · ' + body.slice(0, 120) : ''));
    }
    var data = await resp.json();
    return {
      name: data.name,
      fullname: data.fullname || data.name,
      avatarUrl: data.avatarUrl || null,
      orgs: (data.orgs || []).map(function (o) { return o.name; })
    };
  }

  async function setToken(t) {
    var trimmed = (t || '').trim();
    if (!trimmed) {
      state.token = null;
      state.user = null;
      writeToken(null);
      writeUser(null);
      emit('change');
      return { ok: true, cleared: true };
    }
    if (!isValidTokenFormat(trimmed)) {
      throw new Error('Token must look like hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    }
    state.validating = true;
    emit('change');
    try {
      var u = await whoami(trimmed);
      state.token = trimmed;
      state.user = u;
      writeToken(trimmed);
      writeUser(u);
      emit('change');
      return { ok: true, user: u };
    } catch (e) {
      state.token = null;
      state.user = null;
      writeToken(null);
      writeUser(null);
      emit('change');
      throw e;
    } finally {
      state.validating = false;
      emit('change');
    }
  }

  function clearToken() {
    state.token = null;
    state.user = null;
    writeToken(null);
    writeUser(null);
    emit('change');
  }

  /* ---- Event bus for UI subscribers ---- */
  var listeners = [];
  function on(fn) { listeners.push(fn); return function () {
    listeners = listeners.filter(function (l) { return l !== fn; });
  }; }
  function emit(evt) { listeners.forEach(function (fn) { try { fn(evt, state); } catch (e) { console.error(e); } }); }

  /* ---- Create a Space ---- */
  async function createSpace(opts) {
    // opts: { name, sdk: 'gradio'|'static'|'docker', private }
    var resp = await fetch('https://huggingface.co/api/repos/create', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: opts.name,
        type: 'space',
        sdk: opts.sdk || 'gradio',
        private: !!opts.private,
        hardware: opts.hardware || 'cpu-basic'  // free tier
      })
    });
    if (!resp.ok) {
      var body = '';
      try { body = await resp.text(); } catch (e) {}
      throw new Error('Create Space failed: ' + resp.status + (body ? ' · ' + body.slice(0, 200) : ''));
    }
    var data = await resp.json();
    return data;  // { url, id, name }
  }

  /* ---- List GitHub repo files (recursive) ---- */
  async function listGitHubTree(owner, repo, branch) {
    branch = branch || 'main';
    // Try main, then master
    var urls = [
      'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/' + branch + '?recursive=1',
      'https://api.github.com/repos/' + owner + '/' + repo + '/git/trees/master?recursive=1'
    ];
    for (var i = 0; i < urls.length; i++) {
      var resp = await fetch(urls[i], { headers: { Accept: 'application/vnd.github+json' } });
      if (resp.ok) {
        var data = await resp.json();
        if (data.truncated) {
          console.warn('GitHub tree truncated for ' + owner + '/' + repo + '; some files may be skipped');
        }
        return (data.tree || []).filter(function (e) { return e.type === 'blob'; });
      }
    }
    throw new Error('Could not list GitHub tree for ' + owner + '/' + repo);
  }

  /* ---- Skip heavy / generated / non-source files ---- */
  function shouldSkipFile(path) {
    if (!path) return true;
    var p = path.toLowerCase();
    // Skipped directories
    if (p.indexOf('.git/') === 0) return true;
    if (p.indexOf('node_modules/') === 0) return true;
    if (p.indexOf('__pycache__/') === 0) return true;
    if (p.indexOf('.venv/') === 0 || p.indexOf('venv/') === 0) return true;
    if (p.indexOf('dist/') === 0 || p.indexOf('build/') === 0) return true;
    if (p.indexOf('.pytest_cache/') === 0) return true;
    if (p.indexOf('.idea/') === 0 || p.indexOf('.vscode/') === 0) return true;
    // Skipped patterns
    if (p.endsWith('.pyc')) return true;
    if (p.endsWith('.lock')) return true;
    if (p.endsWith('yarn.lock') || p.endsWith('pnpm-lock.yaml')) return true;
    // Skip pre-trained model weights (HF downloads them at runtime)
    if (/\.(bin|safetensors|onnx|pt|pth|ckpt|h5|pkl|gguf|npz)$/.test(p)) return true;
    // Skip large media
    if (/\.(mp4|mov|avi|mkv|wav|mp3|flac|ogg)$/.test(p)) return true;
    if (/\.(zip|tar|tar\.gz|tgz|7z|rar)$/.test(p)) return true;
    if (/\.(pdf|docx|pptx|xlsx)$/.test(p)) return true;
    return false;
  }

  /* ---- Upload one file to a Space ---- */
  async function uploadFile(spaceId, path, content) {
    // content: Blob | string | ArrayBuffer
    var blob = content instanceof Blob ? content
             : (typeof content === 'string' ? new Blob([content], { type: 'text/plain' })
             : new Blob([content]));
    var url = 'https://huggingface.co/api/spaces/' + spaceId + '/upload/main/' + path;
    var resp = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/octet-stream' },
      body: blob
    });
    if (!resp.ok) {
      var body = '';
      try { body = await resp.text(); } catch (e) {}
      throw new Error('Upload ' + path + ' failed: ' + resp.status + (body ? ' · ' + body.slice(0, 200) : ''));
    }
    return await resp.json();
  }

  /* ---- Download a raw file from GitHub ---- */
  async function fetchGitHubRaw(owner, repo, branch, path) {
    var url = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + path;
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Fetch ' + path + ' failed: ' + resp.status);
    return await resp.blob();
  }

  /* ---- Deploy a tool from the directory: create Space, push all source files ---- */
  async function deployTool(tool, opts, onProgress) {
    // opts: { spaceName, hardware, private, branch }
    onProgress = onProgress || function () {};
    if (!state.token) throw new Error('No HF token set. Add one in the header first.');

    var branch = opts.branch || 'main';
    onProgress({ stage: 'list', message: 'Listing files in ' + tool._owner + '/' + tool._repo + '…' });
    var tree = await listGitHubTree(tool._owner, tool._repo, branch);
    var files = tree.filter(function (e) { return !shouldSkipFile(e.path); });
    if (files.length === 0) throw new Error('No source files to upload (tree was empty or all skipped).');
    onProgress({ stage: 'list-done', message: files.length + ' files to push', total: files.length, done: 0 });

    // Create the Space
    onProgress({ stage: 'create', message: 'Creating Space ' + opts.spaceName + '…' });
    var space = await createSpace({
      name: opts.spaceName,
      sdk: 'gradio',
      private: !!opts.private,
      hardware: opts.hardware || 'cpu-basic'
    });
    var spaceId = state.user.name + '/' + opts.spaceName;
    onProgress({ stage: 'create-done', message: 'Space created: ' + spaceId, spaceUrl: space.url });

    // Upload files
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        onProgress({ stage: 'upload', message: 'Uploading ' + f.path + '…', total: files.length, done: i, current: f.path });
        var blob = await fetchGitHubRaw(tool._owner, tool._repo, branch, f.path);
        await uploadFile(spaceId, f.path, blob);
        onProgress({ stage: 'upload-done', total: files.length, done: i + 1, current: f.path });
      } catch (e) {
        // Continue on individual file errors but report
        console.warn('Skip ' + f.path + ': ' + e.message);
        onProgress({ stage: 'upload-skip', total: files.length, done: i, current: f.path, error: e.message });
      }
    }
    onProgress({ stage: 'done', message: 'Done. Your Space will build in ~60s.', spaceUrl: 'https://huggingface.co/spaces/' + spaceId });
    return spaceId;
  }

  /* ---- Deploy any HF model as a generated Gradio Space ---- */
  async function deployModel(opts, onProgress) {
    onProgress = onProgress || function () {};
    if (!state.token) throw new Error('No HF token set. Add one in the header first.');
    if (!opts.modelId) throw new Error('Model ID is required (e.g. stabilityai/stable-diffusion-xl-base-1.0).');

    onProgress({ stage: 'inspect', message: 'Inspecting model ' + opts.modelId + '…' });
    var infoResp = await fetch('https://huggingface.co/api/models/' + opts.modelId);
    if (!infoResp.ok) throw new Error('Model not found: ' + opts.modelId + ' (' + infoResp.status + ')');
    var info = await infoResp.json();
    var tags = info.tags || [];
    var isTextGen = tags.indexOf('text-generation') >= 0;
    var isImageGen = tags.indexOf('image-to-image') >= 0 || tags.indexOf('text-to-image') >= 0;
    var isAudio    = tags.indexOf('audio') >= 0 || tags.indexOf('text-to-audio') >= 0 || tags.indexOf('automatic-speech-recognition') >= 0;
    var kind = isTextGen ? 'text'
             : isImageGen ? 'image'
             : isAudio    ? 'audio'
             : (tags.indexOf('text-to-video') >= 0 ? 'video' : 'text');

    onProgress({ stage: 'generate', message: 'Generating Gradio app.py for ' + kind + ' pipeline…' });
    var appPy = buildModelApp(opts.modelId, kind, opts.task || 'default');
    var requirements = (kind === 'text' ? 'gradio>=4.0\ntransformers>=4.40\ntorch>=2.0\naccelerate>=0.27\n'
                       : kind === 'image' ? 'gradio>=4.0\ndiffusers>=0.27\ntransformers>=4.40\ntorch>=2.0\naccelerate>=0.27\nsafetensors>=0.4\n'
                       : kind === 'audio' ? 'gradio>=4.0\ntransformers>=4.40\ntorch>=2.0\nsoundfile\nlibrosa\n'
                       : 'gradio>=4.0\ntransformers>=4.40\ntorch>=2.0\n');

    onProgress({ stage: 'create', message: 'Creating Space ' + opts.spaceName + '…' });
    var space = await createSpace({
      name: opts.spaceName,
      sdk: 'gradio',
      private: !!opts.private,
      hardware: opts.hardware || (kind === 'image' ? 't4-small' : 'cpu-basic')
    });
    var spaceId = state.user.name + '/' + opts.spaceName;
    onProgress({ stage: 'create-done', message: 'Space created: ' + spaceId, spaceUrl: space.url });

    onProgress({ stage: 'upload', message: 'Uploading app.py…' });
    await uploadFile(spaceId, 'app.py', appPy);
    onProgress({ stage: 'upload', message: 'Uploading requirements.txt…' });
    await uploadFile(spaceId, 'requirements.txt', requirements);
    onProgress({ stage: 'done', message: 'Done. Your Space will build in ~90s.', spaceUrl: 'https://huggingface.co/spaces/' + spaceId });
    return spaceId;
  }

  /* ---- Generated app.py for a HF model ---- */
  function buildModelApp(modelId, kind, task) {
    var idLit = JSON.stringify(modelId);
    if (kind === 'text') {
      var lines = [];
      lines.push('import gradio as gr');
      lines.push('from transformers import pipeline, AutoTokenizer, AutoModelForCausalLM');
      lines.push('import torch');
      lines.push('');
      lines.push('MODEL_ID = ' + idLit);
      lines.push('');
      lines.push('print("Loading " + MODEL_ID + "...")');
      lines.push('tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)');
      lines.push('model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32, device_map="auto")');
      lines.push('pipe = pipeline("text-generation", model=model, tokenizer=tokenizer)');
      lines.push('');
      lines.push('def chat(message, history, max_new_tokens, temperature, top_p):');
      lines.push('    if not message.strip(): return "", history');
      lines.push('    msgs = []');
      lines.push('    for h in (history or []):');
      lines.push('        if isinstance(h, (list, tuple)) and len(h) == 2: msgs.append({"role": "user", "content": h[0]}); msgs.append({"role": "assistant", "content": h[1]})');
      lines.push('        elif hasattr(h, "role"): msgs.append({"role": h.role, "content": h.content})');
      lines.push('    msgs.append({"role": "user", "content": message})');
      lines.push('    prompt = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True) if hasattr(tokenizer, "apply_chat_template") else message');
      lines.push('    out = pipe(prompt, max_new_tokens=int(max_new_tokens), temperature=float(temperature), top_p=float(top_p), do_sample=True, return_full_text=False)');
      lines.push('    reply = out[0]["generated_text"] if isinstance(out, list) else str(out)');
      lines.push('    history = (history or []) + [[message, reply]]');
      lines.push('    return "", history');
      lines.push('');
      lines.push('with gr.Blocks(theme=gr.themes.Soft(), title=' + idLit + ') as demo:');
      lines.push('    gr.Markdown("# \\U0001F916 " + ' + idLit + '\\n\\nOne-click deploy via [gradio-pipeline-directory](https://kaidjuric-gradio-pipeline-directory.static.hf.space). Token is yours. The Space runs on HF hardware.")');
      lines.push('    chatbot = gr.Chatbot(label="Chat", height=420)');
      lines.push('    msg = gr.Textbox(label="Message", placeholder="Ask anything" + chr(8230), lines=2)');
      lines.push('    with gr.Row():');
      lines.push('        max_tokens = gr.Slider(32, 1024, value=256, step=32, label="max_new_tokens")');
      lines.push('        temperature = gr.Slider(0.0, 2.0, value=0.7, step=0.05, label="temperature")');
      lines.push('        top_p = gr.Slider(0.0, 1.0, value=0.9, step=0.05, label="top_p")');
      lines.push('    send = gr.Button("Send", variant="primary")');
      lines.push('    send.click(chat, [msg, chatbot, max_tokens, temperature, top_p], [msg, chatbot])');
      lines.push('    msg.submit(chat, [msg, chatbot, max_tokens, temperature, top_p], [msg, chatbot])');
      lines.push('if __name__ == "__main__":');
      lines.push('    demo.queue().launch(server_name="0.0.0.0", server_port=7860)');
      lines.push('');
      return lines.join('\n');
    }
    if (kind === 'image') {
      var img = [];
      img.push('import gradio as gr');
      img.push('from diffusers import StableDiffusionPipeline');
      img.push('import torch');
      img.push('');
      img.push('MODEL_ID = ' + idLit);
      img.push('');
      img.push('print("Loading " + MODEL_ID + "...")');
      img.push('dtype = torch.float16 if torch.cuda.is_available() else torch.float32');
      img.push('pipe = StableDiffusionPipeline.from_pretrained(MODEL_ID, torch_dtype=dtype, safety_checker=None)');
      img.push('if torch.cuda.is_available(): pipe = pipe.to("cuda")');
      img.push('');
      img.push('def generate(prompt, negative_prompt, steps, guidance, width, height, seed):');
      img.push('    if not prompt.strip(): return None');
      img.push('    g = torch.Generator(device=pipe.device).manual_seed(int(seed))');
      img.push('    img = pipe(prompt=prompt, negative_prompt=negative_prompt or None, num_inference_steps=int(steps), guidance_scale=float(guidance), width=int(width), height=int(height), generator=g).images[0]');
      img.push('    return img');
      img.push('');
      img.push('with gr.Blocks(theme=gr.themes.Soft(), title=' + idLit + ') as demo:');
      img.push('    gr.Markdown("# \\U0001F3A8 " + ' + idLit + '\\n\\nOne-click deploy via [gradio-pipeline-directory](https://kaidjuric-gradio-pipeline-directory.static.hf.space). The Space runs on HF hardware.")');
      img.push('    with gr.Row():');
      img.push('        with gr.Column():');
      img.push('            prompt = gr.Textbox(label="Prompt", lines=3, placeholder="A serene mountain lake at sunset" + chr(8230))');
      img.push('            neg = gr.Textbox(label="Negative prompt (optional)", lines=2)');
      img.push('            with gr.Row():');
      img.push('                steps = gr.Slider(10, 80, value=30, step=1, label="Steps")');
      img.push('                guidance = gr.Slider(1, 20, value=7.5, step=0.5, label="Guidance")');
      img.push('            with gr.Row():');
      img.push('                width = gr.Slider(256, 1024, value=512, step=64, label="Width")');
      img.push('                height = gr.Slider(256, 1024, value=512, step=64, label="Height")');
      img.push('            seed = gr.Number(value=42, label="Seed", precision=0)');
      img.push('            btn = gr.Button("Generate", variant="primary")');
      img.push('        with gr.Column():');
      img.push('            out = gr.Image(label="Output", type="pil")');
      img.push('    btn.click(generate, [prompt, neg, steps, guidance, width, height, seed], out)');
      img.push('if __name__ == "__main__":');
      img.push('    demo.queue().launch(server_name="0.0.0.0", server_port=7860)');
      img.push('');
      return img.join('\n');
    }
    if (kind === 'audio') {
      var aud = [];
      aud.push('import gradio as gr');
      aud.push('from transformers import pipeline');
      aud.push('');
      aud.push('MODEL_ID = ' + idLit);
      aud.push('');
      aud.push('print("Loading " + MODEL_ID + "...")');
      aud.push('pipe = pipeline("automatic-speech-recognition", model=MODEL_ID)');
      aud.push('');
      aud.push('def transcribe(audio):');
      aud.push('    if audio is None: return ""');
      aud.push('    result = pipe(audio)');
      aud.push('    return result.get("text", "") if isinstance(result, dict) else str(result)');
      aud.push('');
      aud.push('demo = gr.Interface(');
      aud.push('    fn=transcribe,');
      aud.push('    inputs=gr.Audio(type="filepath", label="Audio (wav/mp3)"),');
      aud.push('    outputs=gr.Textbox(label="Transcription", lines=6),');
      aud.push('    title=' + idLit + ',');
      aud.push('    description="One-click deploy via [gradio-pipeline-directory](https://kaidjuric-gradio-pipeline-directory.static.hf.space). Runs on HF hardware.",');
      aud.push('    theme=gr.themes.Soft(),');
      aud.push(')');
      aud.push('if __name__ == "__main__":');
      aud.push('    demo.queue().launch(server_name="0.0.0.0", server_port=7860)');
      aud.push('');
      return aud.join('\n');
    }
    // Generic text-generation fallback
    return buildModelApp(modelId, 'text', task);
  }

  /* ---- Expose ---- */
  window.HFDeploy = {
    // state
    getToken: function () { return state.token; },
    getUser:  function () { return state.user; },
    isReady:  function () { return !!state.token && !!state.user; },
    on: on,
    // actions
    setToken: setToken,
    clearToken: clearToken,
    whoami: whoami,
    createSpace: createSpace,
    listGitHubTree: listGitHubTree,
    uploadFile: uploadFile,
    fetchGitHubRaw: fetchGitHubRaw,
    deployTool: deployTool,
    deployModel: deployModel,
    buildModelApp: buildModelApp,
    shouldSkipFile: shouldSkipFile
  };
})();
