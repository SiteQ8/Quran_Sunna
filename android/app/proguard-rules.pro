# The page reaches the app through these methods by name, so R8 must not
# rename or remove them: a stripped bridge would leave the adhan unarmed and
# sharing silent, and nothing in the java would look wrong.
-keepclasseswithmembers class com.eworldq8.sunnati.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# The manifest names these by string, and the alarm's pending intent must find
# its receiver after an update.
-keep class com.eworldq8.sunnati.MainActivity { *; }
-keep class com.eworldq8.sunnati.AdhanReceiver { *; }
-keep class com.eworldq8.sunnati.BootReceiver { *; }
-keep class com.eworldq8.sunnati.AdhanToggleActivity { *; }
-keep class com.eworldq8.sunnati.CrashActivity { *; }
-keep class com.eworldq8.sunnati.App { *; }

# A crash report is worth reading, so the lines survive and the mapping file
# uploaded to the store turns the names back.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
