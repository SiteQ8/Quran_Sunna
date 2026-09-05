package io.github.siteq8.sunnati;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The Ojeiri table shipped in res/raw, the same file the web app carries. */
public final class OjeiriTable implements PrayerTimes.PublishedTable {

    private static final Pattern ROW = Pattern.compile(
        "\"(\\d{4}-\\d{2}-\\d{2})\":\\[(\\d+),(\\d+),(\\d+),(\\d+),(\\d+),(\\d+)\\]");

    private final Map<String, int[]> days = new HashMap<>();

    public OjeiriTable(Context context) {
        try (InputStream in = context.getResources().openRawResource(R.raw.ojeiri)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            Matcher m = ROW.matcher(buf.toString("UTF-8"));
            while (m.find()) {
                days.put(m.group(1), new int[] {
                    Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)),
                    Integer.parseInt(m.group(5)), Integer.parseInt(m.group(6)), Integer.parseInt(m.group(7)) });
            }
        } catch (Exception ignored) {
            /* with no table every day falls to the formula, which is still right to a minute */
        }
    }

    @Override
    public int[] lookup(int year, int month, int day) {
        return days.get(String.format(Locale.US, "%04d-%02d-%02d", year, month, day));
    }

    public int size() { return days.size(); }
}
