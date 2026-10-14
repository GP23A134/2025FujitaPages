import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** inputのTSVを使ってクラス一覧とクラス間関係を更新します。 */
public final class ClassRelationUpdater {
    private static final Path INPUT_DIRECTORY = Paths.get("data/input");
    private static final Path CLASS_INPUT = INPUT_DIRECTORY.resolve("class-list.tsv");
    private static final Path RELATION_INPUT = INPUT_DIRECTORY.resolve("class-relation.tsv");
    private static final Path CLASS_DATA = Paths.get("data/integrated-data/class-data.json");
    private static final Path MIDDLE_LIST = Paths.get("data/integrated-data/middle-class-list.json");
    private static final Path TOP_LIST = Paths.get("data/integrated-data/top-class-list.json");
    private static final String URI_PREFIX = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private ClassRelationUpdater() {}

    public static void main(String[] args) throws IOException {
        JsonObject classData = readJson(CLASS_DATA);
        Map<String, String> classes = readClasses(classData);
        addInputClasses(classes);
        List<String[]> relations = readRelations(classes);
        normalizeDirectTargetRelations(classes, relations);
        writeClassData(classes, relations);
        writeList(MIDDLE_LIST, classes, "m_");
        writeList(TOP_LIST, classes, "t_");
        System.out.println("クラス一覧と親子関係を更新しました。");
    }

    private static Map<String, String> readClasses(JsonObject root) {
        Map<String, String> result = new LinkedHashMap<>();
        for (var element : root.getAsJsonArray("classes")) {
            JsonObject item = element.getAsJsonObject();
            result.put(item.get("id").getAsString(), item.get("label").getAsString());
        }
        return result;
    }

    private static void addInputClasses(Map<String, String> classes) throws IOException {
        List<String> lines = readTsv(CLASS_INPUT, "種類\tID\tラベル");
        Map<String, Integer> next = nextNumbers(classes);
        for (String line : lines) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 3) throw new IOException("class-list.tsvの列数が不正です: " + line);
            String type = columns[0].trim().toLowerCase();
            String id = columns[1].trim();
            String label = columns[2].trim();
            String prefix = prefix(type);
            if (prefix == null || label.isEmpty()) throw new IOException("種類またはラベルが不正です: " + line);
            if (id.isEmpty()) {
                int number = next.compute(prefix, (key, value) -> value + 1) - 1;
                id = URI_PREFIX + prefix + String.format("%05d", number);
            } else {
                id = normalizeId(id);
            }
            classes.put(id, label);
        }
    }

    private static List<String[]> readRelations(Map<String, String> classes) throws IOException {
        List<String[]> result = new ArrayList<>();
        for (String line : readTsv(RELATION_INPUT, "子クラスID\t親クラスID")) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 2) throw new IOException("class-relation.tsvの列数が不正です: " + line);
            String child = normalizeId(columns[0]);
            String parent = normalizeId(columns[1]);
            if (!classes.containsKey(child) || !classes.containsKey(parent)) {
                throw new IOException("一覧にないクラスIDです: " + line);
            }
            result.add(new String[] { child, parent });
        }
        return result;
    }

    /** 対象クラスから上位クラスへの直接関係を、実データの中間クラス経由へ変換します。 */
    private static void normalizeDirectTargetRelations(Map<String, String> classes, List<String[]> relations) {
        Map<String, String> middleByTop = new LinkedHashMap<>();
        int nextMiddleNumber = nextNumbers(classes).get("m_");
        List<String[]> normalized = new ArrayList<>();
        for (String[] relation : relations) {
            if (shortId(relation[0]).startsWith("m_") && shortId(relation[1]).startsWith("t_")) {
                middleByTop.putIfAbsent(relation[1], relation[0]);
            }
        }
        for (String[] relation : relations) {
            String child = relation[0];
            String parent = relation[1];
            if (shortId(child).startsWith("c_") && shortId(parent).startsWith("t_")) {
                String middle = middleByTop.get(parent);
                if (middle == null) {
                    middle = URI_PREFIX + "m_" + String.format("%05d", nextMiddleNumber++);
                    classes.put(middle, "未分類（" + classes.get(parent) + "）");
                    normalized.add(new String[] { middle, parent });
                }
                middleByTop.put(parent, middle);
                normalized.add(new String[] { child, middle });
            } else {
                normalized.add(relation);
            }
        }
        relations.clear();
        relations.addAll(normalized);
    }

    private static void writeClassData(Map<String, String> classes, List<String[]> relations) throws IOException {
        JsonObject root = new JsonObject();
        JsonArray classArray = new JsonArray();
        classes.forEach((id, label) -> {
            JsonObject item = new JsonObject();
            item.addProperty("id", id);
            item.addProperty("label", label);
            classArray.add(item);
        });
        JsonArray relationArray = new JsonArray();
        for (String[] relation : relations) {
            JsonObject item = new JsonObject();
            item.addProperty("child", relation[0]);
            item.addProperty("parent", relation[1]);
            item.addProperty("relation", "subClassOf");
            relationArray.add(item);
        }
        root.add("classes", classArray);
        root.add("relations", relationArray);
        writeJson(CLASS_DATA, root);
    }

    private static void writeList(Path output, Map<String, String> classes, String prefix) throws IOException {
        JsonObject root = new JsonObject();
        JsonArray array = new JsonArray();
        classes.entrySet().stream().filter(entry -> entry.getKey().startsWith(URI_PREFIX + prefix))
                .forEach(entry -> {
                    JsonObject item = new JsonObject();
                    item.addProperty("id", entry.getKey());
                    item.addProperty("label", entry.getValue());
                    array.add(item);
                });
        root.add("classes", array);
        writeJson(output, root);
    }

    private static List<String> readTsv(Path file, String header) throws IOException {
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        String actualHeader = lines.isEmpty() ? "" : lines.get(0).replace("\ufeff", "");
        String normalizedHeader = String.join("\t", actualHeader.split("\t", -1)).trim();
        normalizedHeader = String.join("\t", java.util.Arrays.stream(normalizedHeader.split("\t", -1))
                .map(String::trim).toList());
        String expectedHeader = String.join("\t", java.util.Arrays.stream(header.split("\t", -1))
                .map(String::trim).toList());
        if (lines.isEmpty() || !normalizedHeader.equals(expectedHeader)) {
            throw new IOException("TSVヘッダーが不正です: " + file);
        }
        return lines.subList(1, lines.size()).stream().filter(line -> !line.isBlank()).toList();
    }

    private static Map<String, Integer> nextNumbers(Map<String, String> classes) {
        Map<String, Integer> result = new LinkedHashMap<>();
        for (String prefix : List.of("c_", "m_", "t_")) {
            int max = classes.keySet().stream().map(ClassRelationUpdater::shortId)
                    .filter(id -> id.startsWith(prefix)).map(id -> id.substring(prefix.length()))
                    .filter(number -> number.matches("\\d+")).mapToInt(Integer::parseInt).max().orElse(-1);
            result.put(prefix, max + 1);
        }
        return result;
    }

    private static String prefix(String type) {
        return switch (type) { case "class", "対象", "対象クラス" -> "c_";
            case "middle", "中間", "中間クラス" -> "m_";
            case "top", "上位", "上位クラス" -> "t_"; default -> null; };
    }

    private static String normalizeId(String value) {
        String id = value.trim();
        return id.startsWith("<") && id.endsWith(">") ? id.substring(1, id.length() - 1) :
                (id.startsWith("http") ? id : URI_PREFIX + id);
    }

    private static String shortId(String value) {
        int slash = value.lastIndexOf('/');
        return slash < 0 ? value : value.substring(slash + 1);
    }

    private static JsonObject readJson(Path path) throws IOException {
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader).getAsJsonObject();
        }
    }

    private static void writeJson(Path path, JsonObject root) throws IOException {
        Files.createDirectories(path.getParent());
        Files.writeString(path, GSON.toJson(root), StandardCharsets.UTF_8);
    }
}
