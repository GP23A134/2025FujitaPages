import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** 初回取得時のクラスID・ラベル対応と、現在の統合データを照合します。 */
public final class ClassLabelConsistencyChecker {
    private static final String CLASS_URI_PREFIX = "https://kozaki-lab.jp/REFV-KG/class/c_";
    private static final Path INITIAL_DIRECTORY = Paths.get("data/query-result");
    private static final Path CURRENT_FILE = Paths.get("data/integrated-data/class-data.json");

    private ClassLabelConsistencyChecker() {}

    public static void main(String[] args) throws IOException {
        Path initial = args.length > 0 ? Paths.get(args[0]) : INITIAL_DIRECTORY;
        Path current = args.length > 1 ? Paths.get(args[1]) : CURRENT_FILE;
        Map<String, String> initialLabels = new LinkedHashMap<>();
        Map<String, Integer> initialCounts = new LinkedHashMap<>();
        readInitial(initial, initialLabels, initialCounts);
        Map<String, String> currentLabels = readCurrent(current);

        List<String> errors = new ArrayList<>();
        List<String> additions = new ArrayList<>();
        // SPARQLのbindingでは同じクラスが複数行に現れるため、初回側の出現回数は検査しない。
        initialLabels.forEach((id, label) -> {
            if (!currentLabels.containsKey(id)) {
                errors.add("現在データに存在しないID: " + id + " (初回ラベル: " + label + ")");
            } else if (!label.equals(currentLabels.get(id))) {
                errors.add("ラベル不一致: " + id + " 初回=" + label + " 現在=" + currentLabels.get(id));
            }
        });
        currentLabels.forEach((id, label) -> {
            if (!initialLabels.containsKey(id)) additions.add("現在データにのみ存在するID: " + id + " (ラベル: " + label + ")");
        });
        errors.sort(Comparator.naturalOrder());
        additions.sort(Comparator.naturalOrder());

        System.out.printf("初回: %d件、現在: %d件、対応不一致: %d件、追加: %d件%n",
                initialLabels.size(), currentLabels.size(), errors.size(), additions.size());
        errors.forEach(System.out::println);
        additions.forEach(message -> System.out.println("追加: " + message));
        if (!errors.isEmpty()) throw new IOException("クラスID・ラベル対応の検査に失敗しました。");
        System.out.println("クラスIDとラベルの対応は一致しています。");
    }

    private static void readInitial(Path path, Map<String, String> labels, Map<String, Integer> counts)
            throws IOException {
        List<Path> files = new ArrayList<>();
        if (Files.isDirectory(path)) {
            try (var stream = Files.walk(path)) {
                stream.filter(file -> file.toString().endsWith(".json")).sorted().forEach(files::add);
            }
        } else files.add(path);
        if (files.isEmpty()) throw new IOException("初回取得データが見つかりません: " + path);
        for (Path file : files) {
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
                JsonObject results = root.getAsJsonObject("results");
                if (results == null || !results.has("bindings")) continue;
                for (JsonElement element : results.getAsJsonArray("bindings")) {
                    JsonObject binding = element.getAsJsonObject();
                    binding.entrySet().forEach(entry -> {
                        JsonObject value = entry.getValue().isJsonObject() ? entry.getValue().getAsJsonObject() : null;
                        if (value == null || !value.has("type") || !"uri".equals(value.get("type").getAsString())) return;
                        String id = value.get("value").getAsString();
                        if (!id.startsWith(CLASS_URI_PREFIX)) return;
                        String labelKey = entry.getKey() + "Label";
                        JsonObject labelValue = binding.has(labelKey) ? binding.getAsJsonObject(labelKey) : null;
                        if (labelValue == null || !labelValue.has("value")) return;
                        String label = labelValue.get("value").getAsString();
                        counts.merge(id, 1, Integer::sum);
                        if (labels.containsKey(id) && !labels.get(id).equals(label))
                            throw new IllegalStateException("初回データ内でラベルが不一致: " + id);
                        labels.putIfAbsent(id, label);
                    });
                }
            } catch (IllegalStateException e) {
                throw new IOException(e.getMessage(), e);
            }
        }
    }

    private static Map<String, String> readCurrent(Path file) throws IOException {
        if (!Files.isRegularFile(file)) throw new IOException("現在データが見つかりません: " + file);
        Map<String, String> result = new LinkedHashMap<>();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
            for (JsonElement element : root.getAsJsonArray("classes")) {
                JsonObject item = element.getAsJsonObject();
                String id = item.get("id").getAsString();
                String label = item.get("label").getAsString();
                if (!id.startsWith(CLASS_URI_PREFIX)) continue;
                if (result.containsKey(id)) throw new IOException("現在データ内でIDが重複: " + id);
                result.put(id, label);
            }
        }
        return result;
    }
}
