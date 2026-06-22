

function PostData(url){
    this.url = url;
}


PostData.prototype.post = function(message, success_cb, error_cb){
    fetch(this.url, {
    method: "POST",
    
    headers: {
        "Content-Type": "application/sparql-update"
    },
    body: message
    })
    //.then(response => response.json())
    .then(result => {
        console.log("Success:", result);
        if (result.status == null){
            console.error("レスポンスコード未格納:"+result);
            if (error_cb != null){
                error_cb("レスポンスコード未格納:"+result);
            }
            return;
        }

        if (200 <= result.status && result.status < 300){
            console.log("更新成功:["+result.status+"]");
            if (success_cb != null){
                success_cb("UPDATEが正常に行われました:レスポンスコード["+result.status+"]");
            }
        } else {
            // 応答は返ったが何か異常が発生した
            console.error("エラー:レスポンスコード["+result.status+"]");
            if (error_cb != null){
                error_cb("エラー:レスポンスコード["+result.status+"]");
            }
        }
    })
    .catch(error => {
        console.error("Error:", error);
        if (error_cb != null){
            error_cb("通信異常:"+error);
        }
    });
}