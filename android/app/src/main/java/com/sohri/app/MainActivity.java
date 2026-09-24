package com.sohri.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.SystemBarStyle;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Affiche l'appli web (dossier www/, embarqué dans l'APK) dans une WebView plein écran et lui
 * fournit ce qu'une WebView ne gère pas seule : choix de photos et de fichiers, ouverture des liens
 * dans l'appli adaptée (Google Maps...), ouverture/partage/enregistrement de fichiers, vidéo en
 * plein écran, bouton retour, presse-papiers, marges des barres système et thème clair/sombre.
 */
public class MainActivity extends ComponentActivity {

    // Les fichiers de www/ sont servis sur ce domaine réservé, intercepté localement : l'appli
    // fonctionne hors connexion et ses données (IndexedDB) restent liées à une origine stable.
    private static final String APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final String PREFS = "sohri";
    private static final String PREF_THEME = "theme";
    // Fichiers reçus de la page pour être ouverts, partagés ou enregistrés (voir res/xml/file_paths.xml).
    private static final String EXPORT_DIR = "exports";

    private FrameLayout root;
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> pendingFileCallback;
    private SharedPreferences prefs;
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();
    private Transfer pendingSave;
    private View fullscreenView; // vidéo en plein écran
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    // Lus par la page via AndroidBridge, depuis un autre thread : d'où volatile.
    private volatile boolean systemDark;
    private volatile String themePreference = "auto"; // "auto", "light" ou "dark"
    private volatile int[] safeAreaInsets = {0, 0, 0, 0}; // haut, droite, bas, gauche, en px CSS

    private final ActivityResultLauncher<PickVisualMediaRequest> pickImage =
            registerForActivityResult(new ActivityResultContracts.PickVisualMedia(),
                    uri -> deliverFiles(uri == null ? null : new Uri[]{uri}));
    private final ActivityResultLauncher<PickVisualMediaRequest> pickImages =
            registerForActivityResult(new ActivityResultContracts.PickMultipleVisualMedia(),
                    uris -> deliverFiles(uris.toArray(new Uri[0])));
    private final ActivityResultLauncher<Intent> pickFiles =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),
                    result -> deliverFiles(parseFileResult(result)));
    private final ActivityResultLauncher<Intent> saveDocument =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),
                    this::onSaveLocationChosen);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        themePreference = prefs.getString(PREF_THEME, "auto");
        systemDark = isNightMode(getResources().getConfiguration());
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        root = new FrameLayout(this);
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> applyInsets(insets));
        createWebView();
        applyAppTheme();
        new Thread(this::cleanOldExports).start();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (fullscreenView != null) {
                    exitFullscreen();
                    return;
                }
                // La page traite le retour (fermer le menu, quitter un formulaire...) ; sinon on quitte.
                webView.evaluateJavascript("window.handleBackButton ? handleBackButton() : false", result -> {
                    if (!"true".equals(result)) {
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                });
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(backgroundColor());
        webView.loadUrl(START_URL);
    }

    /** L'appli s'affiche sous les barres système : leurs dimensions sont transmises à la page. */
    private WindowInsetsCompat applyInsets(WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
        // Clavier ouvert : la WebView s'arrête au-dessus de lui et la page n'a plus de marge en bas.
        root.setPadding(0, 0, 0,
                keyboardVisible ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
        float density = getResources().getDisplayMetrics().density;
        safeAreaInsets = new int[]{
                Math.round(bars.top / density),
                Math.round(bars.right / density),
                keyboardVisible ? 0 : Math.round(bars.bottom / density),
                Math.round(bars.left / density)};
        sendInsetsToPage();
        return WindowInsetsCompat.CONSUMED;
    }

    /* ---------- Thème : « Automatique » (celui du téléphone), « Clair » ou « Sombre » ---------- */

    private boolean isAppDark() {
        return "dark".equals(themePreference) || ("auto".equals(themePreference) && systemDark);
    }

    private int backgroundColor() {
        return ContextCompat.getColor(this, isAppDark() ? R.color.app_background_dark : R.color.app_background_light);
    }

    /** Icônes des barres système lisibles et fond assorti au thème de l'appli. */
    private void applyAppTheme() {
        SystemBarStyle style = isAppDark()
                ? SystemBarStyle.dark(Color.TRANSPARENT)
                : SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT);
        EdgeToEdge.enable(this, style, style);
        int background = backgroundColor();
        root.setBackgroundColor(background);
        if (webView != null) webView.setBackgroundColor(background);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean dark = isNightMode(newConfig);
        if (dark == systemDark) return;
        // Le téléphone passe en mode clair ou sombre (sans recréer l'écran) ; la page suit si « Automatique ».
        systemDark = dark;
        applyAppTheme();
        sendSystemThemeToPage();
    }

    private void sendSystemThemeToPage() {
        runInPage("window.onSystemThemeChanged && onSystemThemeChanged(" + systemDark + ")");
    }

    private void sendInsetsToPage() {
        int[] i = safeAreaInsets;
        runInPage("window.setSafeAreaInsets && setSafeAreaInsets("
                + i[0] + "," + i[1] + "," + i[2] + "," + i[3] + ")");
    }

    private void runInPage(String script) {
        if (webView != null) webView.evaluateJavascript(script, null);
    }

    /* ---------- Liens et fichiers ---------- */

    /** Ouvre un lien dans l'appli adaptée (Google Maps, navigateur, téléphone...) et non dans la WebView. */
    private void openExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("geo")
                && !scheme.equals("mailto") && !scheme.equals("tel")) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    /** Renvoie les fichiers choisis au champ <input type="file"> qui les a demandés. */
    private void deliverFiles(Uri[] uris) {
        if (pendingFileCallback == null) return;
        pendingFileCallback.onReceiveValue(uris != null && uris.length > 0 ? uris : null);
        pendingFileCallback = null;
    }

    private static Uri[] parseFileResult(ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != RESULT_OK || data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null) {
            Uri[] uris = new Uri[clip.getItemCount()];
            for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
            return uris;
        }
        return data.getData() == null ? null : new Uri[]{data.getData()};
    }

    private static boolean acceptsOnlyImages(String[] acceptTypes) {
        boolean any = false;
        if (acceptTypes != null) {
            for (String type : acceptTypes) {
                if (type == null || type.trim().isEmpty()) continue;
                if (!type.trim().toLowerCase(Locale.ROOT).startsWith("image/")) return false;
                any = true;
            }
        }
        return any;
    }

    /** Fichier reçu de la page en morceaux (base64), puis ouvert, partagé ou enregistré. */
    private static final class Transfer {
        final File file;
        final String mimeType;
        final OutputStream out;

        Transfer(File file, String mimeType, OutputStream out) {
            this.file = file;
            this.mimeType = mimeType;
            this.out = out;
        }
    }

    private Transfer transfer(String id) throws IOException {
        Transfer transfer = transfers.get(id);
        if (transfer == null) throw new IOException("Transfert inconnu : " + id);
        return transfer;
    }

    private void handOver(Transfer transfer, String action) {
        String type = mimeTypeOf(transfer);
        try {
            if ("save".equals(action)) {
                pendingSave = transfer;
                saveDocument.launch(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(type)
                        .putExtra(Intent.EXTRA_TITLE, transfer.file.getName()));
                return;
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", transfer.file);
            if ("share".equals(action)) {
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType(type)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(transfer.file.getName(), uri));
                startActivity(Intent.createChooser(send, null));
            } else {
                startActivity(new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, type)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            }
        } catch (ActivityNotFoundException e) {
            pendingSave = null;
            Toast.makeText(this, R.string.no_app_for_file, Toast.LENGTH_SHORT).show();
        }
    }

    /** « Enregistrer sous » : copie du fichier vers l'emplacement choisi (Téléchargements, Drive...). */
    private void onSaveLocationChosen(ActivityResult result) {
        Transfer transfer = pendingSave;
        pendingSave = null;
        Intent data = result.getData();
        if (transfer == null || result.getResultCode() != RESULT_OK || data == null || data.getData() == null) return;
        Uri target = data.getData();
        new Thread(() -> {
            boolean saved = copyToUri(transfer.file, target);
            runOnUiThread(() -> Toast.makeText(this,
                    saved ? R.string.file_saved : R.string.file_save_failed, Toast.LENGTH_SHORT).show());
        }).start();
    }

    private boolean copyToUri(File source, Uri target) {
        try (InputStream in = new FileInputStream(source);
             OutputStream out = getContentResolver().openOutputStream(target)) {
            if (out == null) return false;
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return true;
        } catch (IOException | SecurityException e) {
            return false;
        }
    }

    private static String mimeTypeOf(Transfer transfer) {
        String type = transfer.mimeType;
        if (type != null && !type.isEmpty() && !"application/octet-stream".equals(type)) return type;
        String name = transfer.file.getName();
        int dot = name.lastIndexOf('.');
        String guess = dot < 0 ? null
                : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return guess != null ? guess : "application/octet-stream";
    }

    private static String safeFileName(String name) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.isEmpty() || cleaned.startsWith(".")) cleaned = "fichier" + cleaned;
        return cleaned.length() > 120 ? cleaned.substring(0, 120) : cleaned;
    }

    /** Fichiers transmis il y a plus d'un jour : les applis qui les ont reçus en ont fait une copie. */
    private void cleanOldExports() {
        File[] dirs = new File(getCacheDir(), EXPORT_DIR).listFiles();
        if (dirs == null) return;
        long limit = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
        for (File dir : dirs) {
            if (dir.lastModified() >= limit) continue;
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) file.delete();
            }
            dir.delete();
        }
    }

    /* ---------- Vidéo en plein écran (bouton ⛶ des commandes vidéo) ---------- */

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;
        view.setBackgroundColor(Color.BLACK);
        root.addView(view, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .show(WindowInsetsCompat.Type.systemBars());
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private static boolean isNightMode(Configuration config) {
        return (config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        deliverFiles(null);
        for (Transfer transfer : transfers.values()) {
            try {
                transfer.out.close();
            } catch (IOException ignored) {
                // fichier temporaire abandonné, effacé au prochain démarrage
            }
        }
        transfers.clear();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // La page lit ces valeurs au démarrage ; renvoyées au cas où elles auraient changé depuis.
            sendSystemThemeToPage();
            sendInsetsToPage();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Moteur de rendu arrêté (plantage, ou manque de mémoire) : on recrée la WebView au lieu
            // de laisser l'appli planter. Les données déjà enregistrées ne sont pas touchées.
            deliverFiles(null);
            exitFullscreen();
            root.removeView(view);
            view.destroy();
            if (view == webView) createWebView();
            return true;
        }
    }

    private final class AppWebChromeClient extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            enterFullscreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            deliverFiles(null); // annule une éventuelle demande précédente restée sans réponse
            pendingFileCallback = callback;
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            try {
                if (acceptsOnlyImages(params.getAcceptTypes())) {
                    // Sélecteur de photos d'Android : aucune autorisation d'accès aux fichiers requise.
                    PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
                            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                            .build();
                    (multiple ? pickImages : pickImage).launch(request);
                } else {
                    Intent intent = params.createIntent();
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
                    pickFiles.launch(intent);
                }
            } catch (ActivityNotFoundException e) {
                deliverFiles(null);
                Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    /** Méthodes appelables depuis le JavaScript de la page, via window.AndroidBridge. */
    private final class AndroidBridge {
        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(Uri.parse(url)));
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            return systemDark;
        }

        @JavascriptInterface
        public String getThemePreference() {
            return themePreference;
        }

        @JavascriptInterface
        public void setThemePreference(String preference) {
            themePreference = "light".equals(preference) || "dark".equals(preference) ? preference : "auto";
            prefs.edit().putString(PREF_THEME, themePreference).apply();
            runOnUiThread(MainActivity.this::applyAppTheme);
        }

        @JavascriptInterface
        public String getSafeAreaInsets() {
            int[] i = safeAreaInsets;
            return "[" + i[0] + "," + i[1] + "," + i[2] + "," + i[3] + "]";
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), text));
            });
        }

        /* Texte à envoyer (invitation au partage) : SMS, WhatsApp, e-mail... au choix. */
        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, null));
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(MainActivity.this, R.string.no_app_for_text, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }

        /* Fichier envoyé par la page : fileBegin, puis fileAppend pour chaque morceau, puis fileFinish
           avec l'action voulue ("open", "share" ou "save"). */
        @JavascriptInterface
        public String fileBegin(String name, String mimeType) throws IOException {
            File dir = new File(new File(getCacheDir(), EXPORT_DIR), UUID.randomUUID().toString());
            if (!dir.mkdirs()) throw new IOException("Dossier temporaire impossible à créer");
            File file = new File(dir, safeFileName(name));
            transfers.put(dir.getName(), new Transfer(file, mimeType, new BufferedOutputStream(new FileOutputStream(file))));
            return dir.getName();
        }

        @JavascriptInterface
        public void fileAppend(String id, String base64) throws IOException {
            transfer(id).out.write(Base64.decode(base64, Base64.DEFAULT));
        }

        @JavascriptInterface
        public void fileFinish(String id, String action) throws IOException {
            Transfer transfer = transfer(id);
            transfers.remove(id);
            transfer.out.close();
            runOnUiThread(() -> handOver(transfer, action));
        }
    }
}
