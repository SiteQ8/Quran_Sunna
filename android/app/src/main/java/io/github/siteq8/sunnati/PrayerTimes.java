package io.github.siteq8.sunnati;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The prayer times of a day for الكويت, as minutes after local midnight, in the
 * order fajr, sunrise, dhuhr, asr, maghrib, isha.
 *
 * A day the Ojeiri calendar has published is taken from its table exactly; any
 * other day is computed with the ministry's parameters, plus the two minutes on
 * isha the table showed all year. The arithmetic is a line for line port of the
 * app's prayer-engine.js, and the tests compare the two to the minute.
 */
public final class PrayerTimes {

    public static final double KUWAIT_LAT = 29.3759;
    public static final double KUWAIT_LNG = 47.9774;
    public static final double FAJR_ANGLE = 18.0;
    public static final double ISHA_ANGLE = 17.5;
    public static final int ISHA_OFFSET_MINUTES = 2;

    private PrayerTimes() { }

    /** The six times of the given local date, from the table or the formula. */
    public static int[] forDate(int year, int month1to12, int day, PublishedTable table) {
        if (table != null) {
            int[] published = table.lookup(year, month1to12, day);
            if (published != null) return published;
        }
        return compute(year, month1to12, day, KUWAIT_LAT, KUWAIT_LNG, tzOffsetHours(year, month1to12, day));
    }

    static double tzOffsetHours(int y, int m, int d) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kuwait"));
        c.set(y, m - 1, d, 12, 0, 0);
        return (c.get(Calendar.ZONE_OFFSET) + c.get(Calendar.DST_OFFSET)) / 3600000.0;
    }

    /** The formula alone, for any place, returned as minutes after midnight. */
    public static int[] compute(int y, int m, int d, double lat, double lng, double tz) {
        double jd = julian(y, m, d) - lng / (15 * 24);
        double[] t = { 5 / 24.0, 6 / 24.0, 12 / 24.0, 13 / 24.0, 18 / 24.0, 18 / 24.0 };
        double fajr = 0, sunrise = 0, dhuhr = 0, asr = 0, sunset = 0, isha = 0;
        for (int pass = 0; pass < 3; pass++) {
            fajr = sunAngleTime(jd, FAJR_ANGLE, t[0], true, lat);
            sunrise = sunAngleTime(jd, 0.833, t[1], true, lat);
            dhuhr = midDay(jd, t[2]);
            asr = asrAngleTime(jd, t[3], lat);
            sunset = sunAngleTime(jd, 0.833, t[4], false, lat);
            isha = sunAngleTime(jd, ISHA_ANGLE, t[5], false, lat);
            double[] got = { fajr, sunrise, dhuhr, asr, sunset, isha };
            for (int i = 0; i < 6; i++) if (!Double.isNaN(got[i])) t[i] = got[i] / 24;
        }
        /* the angle based rule for a sun that never sinks far enough */
        double night = fixHour(sunrise - sunset);
        fajr = clampToNight(fajr, sunrise, FAJR_ANGLE, night, true);
        isha = clampToNight(isha, sunset, ISHA_ANGLE, night, false);

        double shift = tz - lng / 15;
        int[] out = new int[6];
        out[0] = (int) Math.round(fixHour(fajr + shift) * 60);
        out[1] = (int) Math.round(fixHour(sunrise + shift) * 60);
        out[2] = (int) Math.round(fixHour(dhuhr + shift) * 60);
        out[3] = (int) Math.round(fixHour(asr + shift) * 60);
        out[4] = (int) Math.round(fixHour(sunset + shift) * 60);
        out[5] = (int) Math.round(fixHour(isha + shift + ISHA_OFFSET_MINUTES / 60.0) * 60);
        return out;
    }

    /* ---- the astronomy, as the app has it ---- */

    private static final double DEG = Math.PI / 180;
    private static double sin(double a) { return Math.sin(a * DEG); }
    private static double cos(double a) { return Math.cos(a * DEG); }
    private static double tan(double a) { return Math.tan(a * DEG); }
    private static double arcsin(double x) { return Math.asin(x) / DEG; }
    private static double arccos(double x) { return Math.acos(x) / DEG; }
    private static double arctan2(double y, double x) { return Math.atan2(y, x) / DEG; }
    private static double arccot(double x) { return Math.atan2(1, x) / DEG; }
    private static double fix(double a, double b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }
    private static double fixAngle(double a) { return fix(a, 360); }
    private static double fixHour(double a) { return fix(a, 24); }

    static double julian(int y, int m, int d) {
        if (m <= 2) { y -= 1; m += 12; }
        double a = Math.floor(y / 100.0);
        double b = 2 - a + Math.floor(a / 4);
        return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
    }

    /** declination and equation of time */
    private static double[] sunPosition(double jd) {
        double d = jd - 2451545.0;
        double g = fixAngle(357.529 + 0.98560028 * d);
        double q = fixAngle(280.459 + 0.98564736 * d);
        double l = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
        double e = 23.439 - 0.00000036 * d;
        double ra = fixHour(arctan2(cos(e) * sin(l), cos(l)) / 15);
        return new double[] { arcsin(sin(e) * sin(l)), q / 15 - ra };
    }

    private static double midDay(double jd, double t) {
        double eqt = sunPosition(jd + t)[1];
        return fixHour(12 - eqt);
    }

    private static double sunAngleTime(double jd, double angle, double t, boolean ccw, double lat) {
        double decl = sunPosition(jd + t)[0];
        double noon = midDay(jd, t);
        double x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
        if (x > 1 || x < -1) return Double.NaN;
        double v = arccos(x) / 15;
        return noon + (ccw ? -v : v);
    }

    private static double asrAngleTime(double jd, double t, double lat) {
        double decl = sunPosition(jd + t)[0];
        double angle = -arccot(1 + tan(Math.abs(lat - decl)));
        return sunAngleTime(jd, angle, t, false, lat);
    }

    private static double clampToNight(double time, double base, double angle, double night, boolean ccw) {
        double portion = angle / 60 * night;
        double gap = ccw ? fixHour(base - time) : fixHour(time - base);
        if (Double.isNaN(time) || gap > portion) return base + (ccw ? -portion : portion);
        return time;
    }

    /** A source of published days, such as the Ojeiri table read from a resource. */
    public interface PublishedTable {
        /** six minutes after midnight, or null when the day is not in the table */
        int[] lookup(int year, int month1to12, int day);
    }
}
