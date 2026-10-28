import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** 統合JSONを、クラスデータとインスタンスデータの2つのJavaScriptへ変換します。 */
public final class WebDataBuild {
    private static final Path INPUT_DIRECTORY = Paths.get("data/integrated");
    private static final Path CLASS_OUTPUT_FILE = Paths.get("web/data/generated/class-data.js");
    private static final Path INSTANCE_OUTPUT_FILE = Paths.get("web/data/generated/instance-data.js");
    private static final String CLASS_URI_PREFIX = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private WebDataBuild() {}

    public static void main(String[] args) throws IOException {
        JsonObject classData = new JsonObject();
        JsonObject integratedClassData = readJson("class-data.json").getAsJsonObject();
        classData.add("classData", integratedClassData);
        classData.add("middleClassList", buildClassList(integratedClassData, "m_"));
        classData.add("topClassList", buildClassList(integratedClassData, "t_"));
        writeScript(CLASS_OUTPUT_FILE, "window.appData = ", classData);

        JsonObject instanceData = new JsonObject();
        instanceData.add("instanceData", readJson("instance-data.json"));
        instanceData.add("instanceClassData", readJson("instance-class-data.json"));
        instanceData.add("targetClassData", readJson("target-class-data.json"));
        writeScript(INSTANCE_OUTPUT_FILE, "Object.assign(window.appData, ", instanceData);
        System.out.println("Web用クラスデータを生成しました: " + CLASS_OUTPUT_FILE);
        System.out.println("Web用インスタンスデータを生成しました: " + INSTANCE_OUTPUT_FILE);
    }

    private static JsonObject buildClassList(JsonObject classData, String idPrefix) {
        JsonArray classes = new JsonArray();
        for (JsonElement element : classData.getAsJsonArray("classes")) {
            JsonObject item = element.getAsJsonObject();
            if (item.has("id") && item.get("id").getAsString()
                    .startsWith(CLASS_URI_PREFIX + idPrefix)) {
                classes.add(item);
            }
        }
        JsonObject result = new JsonObject();
        result.add("classes", classes);
        return result;
    }

    private static void writeScript(Path output, String prefix, JsonObject data) throws IOException {
        Files.createDirectories(output.getParent());
        Path temporary = output.resolveSibling(output.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8)) {
            writer.write(prefix);
            GSON.toJson(data, writer);
            writer.write(prefix.startsWith("Object.assign") ? ");\n" : ";\n");
        }
        try {
            Files.move(temporary, output, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static JsonElement readJson(String fileName) throws IOException {
        Path input = INPUT_DIRECTORY.resolve(fileName);
        if (!Files.isRegularFile(input)) {
            throw new IOException("統合JSONが見つかりません: " + input);
        }
        try (var reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader);
        }
    }
}
