import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** data/classes配下のIDフォルダを走査して統合TSVを生成します。 */
public final class HierarchyIntegrator {
    private static final String DIRECT_HEADER = "対象クラスID\tラベル";
    private static final String OUTPUT_HEADER = "上位クラスID\t上位クラスラベル\t中間クラスID\t中間クラスラベル\t対象クラスID\tラベル";
    private HierarchyIntegrator() {}

    public static void main(String[] args) throws IOException {
        if (args.length != 0 && args.length != 2) {
            System.err.println("使用法: HierarchyIntegrator [<classesフォルダ> <出力TSV>]");
            System.exit(2);
        }
        Path base = Path.of(".").toAbsolutePath().normalize();
        Path classes = args.length == 2 ? Path.of(args[0]) : base.resolve("data/classes");
        Path output = args.length == 2 ? Path.of(args[1]) : base.resolve("output/kgtools-integrated.tsv");
        Map<String, String> topLabels = readLabels(base.resolve("data/上位クラス一覧.tsv"), "上位クラスID\t上位クラスラベル");
        Map<String, String> middleLabels = readLabels(base.resolve("data/中間クラス一覧.tsv"), "中間クラスID\t中間クラスラベル");
        List<String[]> rows = new ArrayList<>();
        try (Stream<Path> stream = Files.walk(classes)) {
            List<Path> files = stream.filter(Files::isRegularFile).filter(p -> p.getFileName().toString().equals("direct.tsv"))
                    .sorted(Comparator.comparing(p -> classes.relativize(p).toString().replace('\\', '/'))).collect(Collectors.toList());
            for (Path file : files) {
                List<String> parts = new ArrayList<>();
                for (Path part : classes.relativize(file).getParent()) parts.add(part.toString());
                if (parts.isEmpty()) throw new IOException("direct.tsvはclasses直下に置けません: " + file);
                String top = label(topLabels, parts.get(0));
                String middle = "(直接)";
                if (parts.size() > 1) {
                    List<String> middleParts = new ArrayList<>();
                    for (String id : parts.subList(1, parts.size())) middleParts.add(label(middleLabels, id));
                    middle = String.join(" / ", middleParts);
                }
                String topId = fullId(topLabels, parts.get(0));
                String middleId = "";
                if (parts.size() > 1) {
                    List<String> middleIds = new ArrayList<>();
                    for (String id : parts.subList(1, parts.size())) middleIds.add(fullId(middleLabels, id));
                    middleId = String.join(" / ", middleIds);
                }
                for (String[] row : TsvUtil.read(file, DIRECT_HEADER)) rows.add(new String[]{topId, top, middleId, middle, row[0], row[1]});
            }
        }
        TsvUtil.write(output, OUTPUT_HEADER, rows);
        System.out.println("統合件数: " + rows.size());
    }

    private static Map<String, String> readLabels(Path file, String header) throws IOException {
        Map<String, String> result = new LinkedHashMap<>();
        for (String[] row : TsvUtil.read(file, header)) {
            String id = row[0].trim();
            int slash = id.lastIndexOf('/');
            if (slash >= 0) id = id.substring(slash + 1);
            result.put(id.replace(">", ""), row[1]);
        }
        return result;
    }

    private static String label(Map<String, String> labels, String folder) throws IOException {
        String value = labels.values().stream().filter(v -> v.equals(folderLabel(folder))).findFirst().orElse(null);
        if (value == null) throw new IOException("一覧にないクラスフォルダです: " + folder);
        return value;
    }

    private static String fullId(Map<String, String> labels, String folder) throws IOException {
        String folderLabel = folderLabel(folder);
        for (Map.Entry<String, String> entry : labels.entrySet()) {
            if (entry.getValue().equals(folderLabel)) return entry.getKey();
        }
        throw new IOException("一覧にないクラスフォルダです: " + folder);
    }

    private static String folderLabel(String folder) {
        String label = folder;
        // t_00000_未分類 / m_00000_未分類 の形式
        int firstSeparator = label.indexOf('_');
        if (firstSeparator >= 0) {
            label = label.substring(firstSeparator + 1);
        }
        int secondSeparator = label.indexOf('_');
        if (secondSeparator >= 0 && label.substring(0, secondSeparator).matches("\\d+")) {
            label = label.substring(secondSeparator + 1);
        }

        return label;
    }
}


