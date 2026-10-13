package com.eworldq8.sunnati;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;

import java.io.File;
import java.nio.ByteBuffer;

/**
 * A recorded video rewritten as a plain mp4. MediaRecorder in the web view
 * writes a fragmented file whose header says it lasts no time at all, the
 * samples and their timing being spread through fragments after it; a
 * gallery shows such a file as 0:00, and WhatsApp asks for an ordinary mp4.
 * The samples are copied as they are, nothing is encoded again, and the muxer
 * writes one index with the real length.
 */
final class Mp4Remux {
    private Mp4Remux() { }

    /** True when out holds the same video as a plain mp4. On false, out is
     *  gone and the caller shares the file as it was recorded. */
    static boolean plain(File in, File out) {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer mux = null;
        boolean ok = false;
        try {
            ex.setDataSource(in.getAbsolutePath());
            int count = ex.getTrackCount();
            if (count < 1 || count > 2) return false;
            mux = new MediaMuxer(out.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int[] track = new int[count];
            long[] shift = new long[count];
            boolean[] seen = new boolean[count];
            int size = 1 << 20;
            for (int i = 0; i < count; i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                /* only what the page records and an mp4 for WhatsApp holds */
                if (!"video/avc".equals(mime) && !"audio/mp4a-latm".equals(mime)) return false;
                if (f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    size = Math.max(size, f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
                }
                track[i] = mux.addTrack(f);
                ex.selectTrack(i);
            }
            ByteBuffer buf = ByteBuffer.allocateDirect(Math.max(size, 4 << 20));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            mux.start();
            int written = 0;
            while (true) {
                int n = ex.readSampleData(buf, 0);
                if (n < 0) break;
                int i = ex.getSampleTrackIndex();
                long t = ex.getSampleTime();
                /* a track that starts before zero, as encoder priming can, is
                   moved up to it: the muxer refuses a negative time */
                if (!seen[i]) { seen[i] = true; shift[i] = t < 0 ? -t : 0; }
                int flags = (ex.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                    ? MediaCodec.BUFFER_FLAG_KEY_FRAME : 0;
                info.set(0, n, t + shift[i], flags);
                mux.writeSampleData(track[i], buf, info);
                written++;
                ex.advance();
            }
            mux.stop();
            ok = written > 0 && out.length() > 0;
            return ok;
        } catch (Exception e) {
            return false;
        } finally {
            ex.release();
            if (mux != null) {
                try { mux.release(); } catch (Exception ignored) { /* never started */ }
            }
            if (!ok && out.exists() && !out.delete()) out.deleteOnExit();
        }
    }
}
