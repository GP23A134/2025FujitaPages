import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** クエリ結果から、インスタンスと所属クラスの対応だけを統合します。 */
public final class DataIntegrate {
    /** クラスIDの共通URIと、階層種別を判定する接頭辞です。 */
    private static final String CLASS_URI_PREFIX =
            "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String TOP_CLASS_PREFIX = "t_";
    private static final String MIDDLE_CLASS_PREFIX = "m_";
    private static final String UNCLASSIFIED_TOP_ID = CLASS_URI_PREFIX + "t_0";

    private static final Path INPUT_DIRECTORY = Paths.get("data/query-results/base");
    private static final Path UPPER_INPUT_DIRECTORY = Paths.get("data/query-results/hierarchy");
    private static final Path INSTANCE_OUTPUT_FILE = Paths.get("data/integrated/instance-data.json");
    private static final Path INSTANCE_CLASS_OUTPUT_FILE = Paths.get("data/integrated/instance-class-data.json");
    private static final Path CLASS_OUTPUT_FILE = Paths.get("data/integrated/class-data.json");
    private static final Path TARGET_CLASS_OUTPUT_FILE = Paths.get("data/integrated/target-class-data.json");
    private static final Path MIDDLE_CLASS_TSV_OUTPUT_FILE = Paths.get("data/output/middle-class-list.tsv");
    private static final Path TOP_CLASS_TSV_OUTPUT_FILE = Paths.get("data/output/top-class-list.tsv");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private DataIntegrate() {}

    /**
     * 基本クエリと上位クラスクエリの結果を読み込み、インスタンス・クラス情報をJSONへ統合します。
     * 上位クラスの入力フォルダーは、存在する場合だけ読み込みます。
     */
    public static void main(String[] args) throws IOException {
        Map<String, Instance> instances = new LinkedHashMap<>();
        Map<String, String> instanceLabels = new LinkedHashMap<>();
        Map<String, String> classLabels = new LinkedHashMap<>();
        Map<String, Set<String>> classRelations = new LinkedHashMap<>();

        if (!Files.isDirectory(INPUT_DIRECTORY)) {
            throw new IOException("入力フォルダーが見つかりません: " + INPUT_DIRECTORY);
        }

        try (var files = Files.list(INPUT_DIRECTORY)) {
            for (Path file : files.filter(path -> path.toString().endsWith(".json")).sorted().toList()) {
                readBindings(file, instances, instanceLabels, classLabels, classRelations);
            }
        }
        boolean hasUpperClassData = Files.isDirectory(UPPER_INPUT_DIRECTORY);
        if (hasUpperClassData) {
            try (var files = Files.list(UPPER_INPUT_DIRECTORY)) {
                List<Path> upperFiles = files.filter(path -> path.toString().endsWith(".json")).sorted().toList();
                hasUpperClassData = !upperFiles.isEmpty();
                for (Path file : upperFiles) {
                    readBindings(file, instances, instanceLabels, classLabels, classRelations);
                }
            }
        }
        if (!hasUpperClassData) {
            addUnclassifiedHierarchy(instances, classLabels, classRelations);
        }

        Files.createDirectories(INSTANCE_OUTPUT_FILE.getParent());
        List<Map<String, String>> outputInstances = new ArrayList<>();
        List<Map<String, String>> outputRelations = new ArrayList<>();
        for (Instance instance : instances.values()) {
            Map<String, String> record = new LinkedHashMap<>();
            record.put("id", instance.id);
            record.put("label", instanceLabels.get(instance.id));
            outputInstances.add(record);
            for (String classId : instance.classIds) {
                if (!classLabels.containsKey(classId)) throw new IOException("クラスのラベルが見つかりません: " + classId);
                Map<String, String> relation = new LinkedHashMap<>();
                relation.put("instance", instance.id);
                relation.put("class", classId);
                outputRelations.add(relation);
            }
        }
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("instances", outputInstances);
        Path temporaryOutput = INSTANCE_OUTPUT_FILE.resolveSibling(INSTANCE_OUTPUT_FILE.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporaryOutput, StandardCharsets.UTF_8)) {
            GSON.toJson(output, writer);
        }
        replaceFile(temporaryOutput, INSTANCE_OUTPUT_FILE);
        Map<String, Object> instanceClassOutput = new LinkedHashMap<>();
        instanceClassOutput.put("relations", outputRelations);
        Path temporaryInstanceClassOutput = INSTANCE_CLASS_OUTPUT_FILE.resolveSibling(INSTANCE_CLASS_OUTPUT_FILE.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporaryInstanceClassOutput, StandardCharsets.UTF_8)) {
            GSON.toJson(instanceClassOutput, writer);
        }
        replaceFile(temporaryInstanceClassOutput, INSTANCE_CLASS_OUTPUT_FILE);
        Map<String, Object> classOutput = new LinkedHashMap<>();
        List<Map<String, String>> classes = new ArrayList<>();
        List<Map<String, String>> targetClasses = new ArrayList<>();
        for (Map.Entry<String, String> entry : classLabels.entrySet()) {
            Map<String, String> clazz = new LinkedHashMap<>();
            clazz.put("id", entry.getKey());
            clazz.put("label", entry.getValue());
            if (entry.getKey().startsWith(CLASS_URI_PREFIX + "c_")) targetClasses.add(clazz);
            else classes.add(clazz);
        }
        List<Map<String, String>> relations = new ArrayList<>();
        for (Map.Entry<String, Set<String>> entry : classRelations.entrySet()) {
            for (String parent : entry.getValue()) {
                Map<String, String> relation = new LinkedHashMap<>();
                relation.put("child", entry.getKey());
                relation.put("parent", parent);
                relation.put("relation", "subClassOf");
                relations.add(relation);
            }
        }
        classOutput.put("classes", classes);
        classOutput.put("relations", relations);
        Path temporaryClassOutput = CLASS_OUTPUT_FILE.resolveSibling(CLASS_OUTPUT_FILE.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporaryClassOutput, StandardCharsets.UTF_8)) {
            GSON.toJson(classOutput, writer);
        }
        replaceFile(temporaryClassOutput, CLASS_OUTPUT_FILE);
        writeClassList(TARGET_CLASS_OUTPUT_FILE, targetClasses);
        writeClassListTsv(MIDDLE_CLASS_TSV_OUTPUT_FILE, classLabels, MIDDLE_CLASS_PREFIX);
        writeClassListTsv(TOP_CLASS_TSV_OUTPUT_FILE, classLabels, TOP_CLASS_PREFIX);
        ClassDataVersion.writeCurrentHash();
        System.out.println("インスタンスJSONを出力しました: " + INSTANCE_OUTPUT_FILE);
        System.out.println("インスタンス・クラス関係JSONを出力しました: " + INSTANCE_CLASS_OUTPUT_FILE);
        System.out.println("クラス統合JSONを出力しました: " + CLASS_OUTPUT_FILE);
        System.out.println("対象クラスJSONを出力しました: " + TARGET_CLASS_OUTPUT_FILE);
        System.out.println("中間クラスTSVを出力しました: " + MIDDLE_CLASS_TSV_OUTPUT_FILE);
        System.out.println("上位クラスTSVを出力しました: " + TOP_CLASS_TSV_OUTPUT_FILE);
    }

    private static void addUnclassifiedHierarchy(Map<String, Instance> instances,
            Map<String, String> classLabels, Map<String, Set<String>> classRelations) {
        classLabels.putIfAbsent(UNCLASSIFIED_TOP_ID, "未分類");
        for (Instance instance : instances.values()) {
            for (String classId : instance.classIds) {
                if (classId.startsWith(CLASS_URI_PREFIX + "c_")) {
                    classRelations.computeIfAbsent(classId, ignored -> new LinkedHashSet<>())
                            .add(UNCLASSIFIED_TOP_ID);
                }
            }
        }
    }

    private static void writeClassList(Path output, List<Map<String, String>> classes) throws IOException {
        Map<String, Object> classListOutput = new LinkedHashMap<>();
        classListOutput.put("classes", classes);
        Files.createDirectories(output.getParent());
        Path temporaryOutput = output.resolveSibling(output.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporaryOutput, StandardCharsets.UTF_8)) {
            GSON.toJson(classListOutput, writer);
        }
        replaceFile(temporaryOutput, output);
    }

    /** 上位または中間クラスの正式ID順で、IDとラベルをTSVとして出力します。 */
    private static void writeClassListTsv(Path output, Map<String, String> classLabels, String idPrefix)
            throws IOException {
        StringBuilder contents = new StringBuilder("ID\tラベル\n");
        classLabels.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith(CLASS_URI_PREFIX + idPrefix))
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> contents.append(entry.getKey())
                        .append('\t').append(entry.getValue()).append('\n'));
        writeTextAtomically(output, contents.toString());
    }

    private static void writeTextAtomically(Path output, String contents) throws IOException {
        Files.createDirectories(output.getParent());
        Path temporary = output.resolveSibling(output.getFileName() + ".tmp");
        Files.writeString(temporary, contents, StandardCharsets.UTF_8);
        replaceFile(temporary, output);
    }

    private static void replaceFile(Path temporary, Path target) throws IOException {
        try {
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * SPARQL結果JSONのbindingsから、ラベル、インスタンスとクラスの対応、クラス階層を収集します。
     */
    private static void readBindings(Path file, Map<String, Instance> instances,
            Map<String, String> instanceLabels, Map<String, String> classLabels,
            Map<String, Set<String>> classRelations) throws IOException {
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
            JsonElement results = root.getAsJsonObject("results").get("bindings");
            for (JsonElement element : results.getAsJsonArray()) {
                JsonObject binding = element.getAsJsonObject();
                collectLabel(binding, "s", "sLabel", instanceLabels);
                collectLabel(binding, "o", "oLabel", instanceLabels);
                collectLabel(binding, "sClass", "sClassLabel", classLabels);
                collectLabel(binding, "oClass", "oClassLabel", classLabels);
                collectLabel(binding, "stClass", "stClassLabel", classLabels);
                collectLabel(binding, "sType", "sTypeLabel", classLabels);
                collectLabel(binding, "oType", "oTypeLabel", classLabels);
                collectLabel(binding, "stType", "stTypeLabel", classLabels);
                collectRelation(binding, "s", "sClass", instances);
                collectRelation(binding, "o", "oClass", instances);
                collectClassRelation(binding, "sClass", "sType", classRelations);
                collectClassRelation(binding, "oClass", "oType", classRelations);
                collectClassRelation(binding, "stClass", "stType", classRelations);
            }
        }
    }

    /**
     * bindings内の子クラスと親クラスを {@code subClassOf} 関係として重複なく保持します。
     */
    private static void collectClassRelation(JsonObject binding, String childKey, String parentKey,
            Map<String, Set<String>> relations) {
        String child = normalizeHierarchyId(value(binding, childKey));
        String parent = normalizeHierarchyId(value(binding, parentKey));
        if (child != null && parent != null) {
            Set<String> parents = relations.computeIfAbsent(child, ignored -> new LinkedHashSet<>());
            // 対象クラス(c_)は所属先を1つに限定する。複数の親がクエリ結果に
            // 含まれる場合は、入力順で最初に現れた親を採用する。
            if (child.startsWith(CLASS_URI_PREFIX + "c_") && !parents.isEmpty()) return;
            parents.add(parent);
        }
    }

    private static void collectLabel(JsonObject binding, String idKey, String labelKey,
            Map<String, String> labels) {
        String id = value(binding, idKey);
        String label = value(binding, labelKey);
        if (isClassBindingKey(idKey)) id = normalizeHierarchyId(id);
        if (id != null && label != null) labels.putIfAbsent(id, label);
    }

    private static boolean isClassBindingKey(String key) {
        return key.endsWith("Class") || key.endsWith("Type");
    }

    private static String normalizeHierarchyId(String id) {
        if (id == null) return null;
        return id.replaceFirst("(?<=/class/)([mt])_0+(\\d+)$", "$1_$2");
    }

    private static void collectRelation(JsonObject binding, String instanceKey, String classKey,
            Map<String, Instance> instances) {
        String instanceId = value(binding, instanceKey);
        String classId = value(binding, classKey);
        if (instanceId == null || classId == null) return;
        instances.computeIfAbsent(instanceId, ignored -> new Instance(instanceId))
                .classIds.add(classId);
    }

    private static String value(JsonObject object, String key) {
        JsonObject value = object.getAsJsonObject(key);
        return value == null || !value.has("value") ? null : value.get("value").getAsString();
    }

    private static final class Instance {
        private final String id;
        private final Set<String> classIds = new LinkedHashSet<>();

        private Instance(String id) { this.id = id; }
    }
}
