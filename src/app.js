const data=[
 {name:"Клиенту хватает HeadHunter",brief:"Работодатель считает, что ему достаточно другой площадки.",opening:"Здравствуйте. Мы сейчас в основном размещаем вакансии на HeadHunter. Там у нас уже всё настроено, поэтому пока не вижу смысла подключать ещё одну площадку."},
 {name:"Нет результата от SuperJob",brief:"Клиент не видит достаточного количества откликов.",opening:"Мы размещались у вас, но откликов практически не было. В итоге вакансию закрыли через другую площадку. Почему я должен снова тратить на это деньги?"},
 {name:"Нерелевантные отклики",brief:"Работодатель получает кандидатов, которые не подходят требованиям.",opening:"Отклики приходят, но большинство кандидатов вообще не подходят. Нам нужны люди с конкретным опытом, а не просто все подряд."},
 {name:"Слишком дорого",brief:"Клиент не готов выделять текущий бюджет на размещение.",opening:"Посмотрел ваши тарифы. Честно говоря, для нас это дорого. Сейчас бюджет ограничен, и я не уверен, что смогу согласовать такую сумму."},
 {name:"Нет кандидатов на рабочие специальности",brief:"Работодатель сомневается, что на площадке есть нужные специалисты.",opening:"Мы ищем сварщиков и слесарей. На подобных сайтах таких специалистов почти нет. Обычно ищем через рекомендации и объявления."}
];
let current=0;
const $=id=>document.getElementById(id);
function show(id){["home","practice","result"].forEach(x=>$(x).classList.toggle("hidden",x!==id))}
function render(){ $("scenarios").innerHTML=data.map((s,i)=>`<button class="scenario" data-i="${i}"><span class="num">СЦЕНАРИЙ 0${i+1}</span><h3>${s.name}</h3><p>${s.brief}</p></button>`).join("");document.querySelectorAll(".scenario").forEach(b=>b.onclick=()=>start(+b.dataset.i))}
function start(i){current=i;$("scenarioName").textContent=data[i].name;$("scenarioBrief").textContent=data[i].brief;$("opening").textContent=data[i].opening;$("dialog").querySelectorAll(".manager-bubble,.client-follow").forEach(n=>n.remove());$("reply").value="";show("practice")}
$("send").onclick=()=>{const v=$("reply").value.trim();if(!v)return;const bubble=document.createElement("div");bubble.className="bubble manager-bubble";bubble.textContent=v;$("dialog").appendChild(bubble);const follow=document.createElement("div");follow.className="bubble client-follow";follow.textContent="Понимаю. А можете пояснить, чем ваше предложение будет отличаться от того, что мы уже пробовали?";$("dialog").appendChild(follow);$("reply").value="";$("dialog").scrollTop=$("dialog").scrollHeight};
$("finish").onclick=()=>show("result");$("back").onclick=()=>show("home");$("againBack").onclick=()=>show("home");$("retry").onclick=()=>start(current);render();
