package com.eworldq8.sunnati;

import android.content.ContentProvider;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Hands a file the app made to the app the reader chose to share it with.
 * Android 7 and later refuse a file:// address passed between apps, and the
 * package carries no androidx to bring FileProvider, so this is the small part
 * of FileProvider it needs: one folder in the cache, read only, by name, for
 * whichever app the share itself granted the address to. Nothing is exported.
 */
public final class SharedFiles extends ContentProvider {
    private static final String FOLDER = "share";
    /* A file older than this goes when the next one is started. The receiving
       app reads a shared file when the reader sends it, which is seconds or
       minutes after the sheet opens; a quarter of an hour covers that. */
    private static final long KEEP_MS = 15 * 60 * 1000L;
    static final String PART = "part-";

    /** The authority the manifest declares as ${applicationId}.share. */
    static String authority(Context c) {
        return c.getPackageName() + ".share";
    }

    static File folder(Context c) throws IOException {
        File dir = new File(c.getCacheDir(), FOLDER);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no share folder");
        return dir;
    }

    static Uri uriOf(Context c, File f) {
        return new Uri.Builder()
            .scheme(ContentResolver.SCHEME_CONTENT)
            .authority(authority(c))
            .appendPath(f.getName())
            .build();
    }

    /** Lets go of half-written files and of anything shared long ago. */
    static void sweep(File dir) {
        File[] all = dir.listFiles();
        if (all == null) return;
        long now = System.currentTimeMillis();
        for (File f : all) {
            if (f.getName().startsWith(PART) || now - f.lastModified() > KEEP_MS) {
                if (!f.delete()) f.deleteOnExit();
            }
        }
    }

    /** The name the receiving app shows: plain letters, digits, dots, dashes. */
    static String cleanName(String name, String ext) {
        StringBuilder b = new StringBuilder();
        if (name != null) {
            for (int i = 0; i < name.length() && b.length() < 60; i++) {
                char ch = name.charAt(i);
                if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
                    || ch == '-' || ch == '_' || ch == '.') b.append(ch);
            }
        }
        String s = b.toString();
        while (s.startsWith(".")) s = s.substring(1);
        if (s.isEmpty() || s.startsWith(PART)) s = "sunnati";
        if (!s.toLowerCase(Locale.ROOT).endsWith(ext)) s += ext;
        return s;
    }

    private File fileOf(Uri uri) throws FileNotFoundException {
        Context c = getContext();
        String name = uri.getLastPathSegment();
        if (c == null || name == null || name.isEmpty() || name.startsWith(".") || name.startsWith(PART)
            || name.indexOf('/') >= 0) throw new FileNotFoundException(String.valueOf(uri));
        File f = new File(new File(c.getCacheDir(), FOLDER), name);
        if (!f.isFile()) throw new FileNotFoundException(name);
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment();
        return name != null && name.toLowerCase(Locale.ROOT).endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("read only");
        return ParcelFileDescriptor.open(fileOf(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /* the name and the size, which a receiving app asks for before it reads;
       any other column asked for is left out, as FileProvider does */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileOf(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] asked = projection != null ? projection
            : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        List<String> names = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        for (String col : asked) {
            if (OpenableColumns.DISPLAY_NAME.equals(col)) { names.add(col); values.add(f.getName()); }
            else if (OpenableColumns.SIZE.equals(col)) { names.add(col); values.add(f.length()); }
        }
        MatrixCursor out = new MatrixCursor(names.toArray(new String[0]), 1);
        out.addRow(values.toArray());
        return out;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read only");
    }
}
