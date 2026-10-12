import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class TsvUtil {
    private TsvUtil() {}

    static List<String[]> read(Path file, String header) throws IOException {
        if (!Files.isRegularFile(file)) throw new IOException("入力ファイルが見つかりません: " + file);
        List<String[]> rows = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            String actual = reader.readLine();
            if (actual != null && !actual.isEmpty() && actual.charAt(0) == '\ufeff') {
                actual = actual.substring(1);
            }
            if (!header.equals(actual)) throw new IOException("ヘッダーが不正です: " + file);
            String line;
            int lineNumber = 1;
            while ((line = reader.readLine()) != null) {
                lineNumber++;
                if (line.isBlank()) continue;
                String[] columns = line.split("\\t", -1);
                if (columns.length != header.split("\\t", -1).length ||
                        java.util.Arrays.stream(columns).anyMatch(String::isBlank)) {
                    throw new IOException("不正なTSV行です (" + file + ":" + lineNumber + ")");
                }
                rows.add(columns);
            }
        }
        return rows;
    }

    static Map<String, String> readKeyValue(Path file, String header) throws IOException {
        Map<String, String> result = new LinkedHashMap<>();
        for (String[] row : read(file, header)) {
            String key = normalizeId(row[0]);
            if (result.put(key, row[1]) != null) throw new IOException("重複キーがあります: " + row[0]);
        }
        return result;
    }

    static String normalizeId(String value) {
        String trimmed = value.trim();
        int marker = trimmed.lastIndexOf("c_");
        return marker >= 0 ? trimmed.substring(marker).replace(">", "") : trimmed;
    }

    static void write(Path file, String header, List<String[]> rows) throws IOException {
        String[] headerColumns = header.split("\\t", -1);
        if (header.isBlank() || java.util.Arrays.stream(headerColumns).anyMatch(String::isBlank)) {
            throw new IllegalArgumentException("ヘッダーが不正です");
        }
        Path parent = file.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        List<String> lines = new ArrayList<>();
        lines.add(header);
        for (String[] row : rows) {
            if (row == null || row.length != headerColumns.length ||
                    java.util.Arrays.stream(row).anyMatch(value -> value == null
                            || value.indexOf('\t') >= 0 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0)) {
                throw new IllegalArgumentException("出力するTSV行が不正です");
            }
            lines.add(String.join("\t", row));
        }
        Files.write(file, lines, StandardCharsets.UTF_8);
    }
}


