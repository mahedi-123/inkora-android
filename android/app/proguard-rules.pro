# The JS bridge is called by name from JavaScript — never rename it.
-keepclassmembers class app.inkora.android.MainActivity$Bridge {
    public *;
}
-keepattributes JavascriptInterface
