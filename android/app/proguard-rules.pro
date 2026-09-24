# Méthodes appelées depuis le JavaScript de la page (window.AndroidBridge) : R8 ne doit ni les
# supprimer ni les renommer, et l'annotation @JavascriptInterface doit rester visible.
-keepattributes RuntimeVisibleAnnotations
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
