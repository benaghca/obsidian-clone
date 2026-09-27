# Loads Cinder (browser mode) in WebKitGTK, the engine of the Linux app, runs a benchmark script in
# the page and prints what it posts. Usage: python3 webkit.py URL SCRIPT.js
import gi, sys, json
gi.require_version('WebKit2','4.1'); gi.require_version('Gtk','3.0')
from gi.repository import WebKit2, Gtk, GLib
url, script = sys.argv[1], open(sys.argv[2]).read()
w = Gtk.Window(); w.set_default_size(1400, 900); m = WebKit2.UserContentManager()
def on(_, r):
    s = r.get_js_value().to_string(); print(s, flush=True)
    if s == 'DONE': Gtk.main_quit()
m.connect('script-message-received::out', on); m.register_script_message_handler('out')
v = WebKit2.WebView.new_with_user_content_manager(m); w.add(v); w.show_all()
def loaded(view, ev):
    if ev == WebKit2.LoadEvent.FINISHED: view.run_javascript(script, None, None, None)
v.connect('load-changed', loaded); v.load_uri(url)
GLib.timeout_add_seconds(300, lambda: (print('TIMEOUT'), Gtk.main_quit()))
Gtk.main()
